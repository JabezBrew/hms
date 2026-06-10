use std::collections::HashMap;
use std::fmt::Debug;
use std::hash::Hash;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use chrono::{DateTime, Utc};
use hms_db::auth::{NewAuthAuditEvent, NewRefreshSession, UserAccount, UserSessionRow};
use hms_db::dashboard::DashboardProjectionRead;
use hms_db::provision::{generate_secret_token, hash_refresh_token, BaselineProvisioning};
use hms_db::search::{OmniSearchFilters, OmniSearchResult};
use hms_domain::auth::{
    ActiveAuthority, AuthUser, PatientDataVisibility, UpdateAuthProfileRequest,
};
use hms_domain::capabilities::{deployment_capabilities_from_features, DeploymentCapabilities};
use hms_domain::deployment::{DeploymentProfile, FeatureKey, NavigationManifest, PermissionCode};
use hms_domain::inventory::PharmacyDispenseListItem;
use hms_domain::patients::{PatientAdministrativeStatus, PatientListItem};
use hms_domain::search::SearchResourceType;
use hms_domain::ward::WardBoardItem;
use hms_events::DomainEventKind;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::net::TcpStream;
use tokio::sync::{Mutex as TokioMutex, Semaphore};
use tokio::time::timeout;
use tracing::warn;
use uuid::Uuid;

use crate::auth::{issue_access_token, verify_access_token, AccessClaims};
use crate::config::{AccountSetupDeliveryMode, Config, OpsAuthMode, OpsPrometheusConfig};
use crate::ops_auth::{CloudflareAccessError, CloudflareAccessIdentity, CloudflareAccessVerifier};
use crate::passwords::hash_password;
use crate::response::{ListResponse, ObjectResponse};
use crate::services::patients::PatientChronicleStartup;

const HOT_READ_CACHE_MAX_ENTRIES: usize = 1024;
const OMNI_SEARCH_CACHE_TTL: Duration = Duration::from_secs(30);
const DASHBOARD_PROJECTION_CACHE_TTL: Duration = Duration::from_secs(30);
const DASHBOARD_REFRESH_QUEUE_THROTTLE: Duration = Duration::from_secs(5);
const PATIENT_CHRONICLE_STARTUP_CACHE_TTL: Duration = Duration::from_secs(30);
const PATIENT_LIST_CACHE_TTL: Duration = Duration::from_secs(30);
const PHARMACY_DISPENSE_CACHE_TTL: Duration = Duration::from_secs(30);
const WARD_BOARD_CACHE_TTL: Duration = Duration::from_secs(30);
const HOT_READ_QUERY_SHAPE_WARMUP_TIMEOUT: Duration = Duration::from_secs(2);
const AUTH_CACHE_MAX_TTL: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub struct AppState {
    inner: Arc<AppStateInner>,
}

struct AppStateInner {
    config: Config,
    started_at: DateTime<Utc>,
    facility_id: Uuid,
    pool: hms_db::PgPool,
    auth_pool: hms_db::PgPool,
    auth_cache: AuthCache,
    hot_read_cache: HotReadCache,
    password_work_limiter: Arc<Semaphore>,
    dashboard_refresh_gate: DashboardRefreshGate,
    cloudflare_access: Option<CloudflareAccessVerifier>,
    account_setup_deliveries: Mutex<Vec<AccountSetupDeliveryRecord>>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct AuthCacheKey {
    user_id: Uuid,
    session_id: Uuid,
    facility_id: Uuid,
    session_version: i64,
    permission_version: i64,
    active_profile: String,
}

impl AuthCacheKey {
    fn from_claims(claims: &AccessClaims) -> Self {
        Self {
            user_id: claims.sub,
            session_id: claims.session_id,
            facility_id: claims.facility_id,
            session_version: claims.session_version,
            permission_version: claims.permission_version,
            active_profile: claims.active_profile.clone(),
        }
    }

    fn from_user_account(user: &UserAccount, session_id: Uuid) -> Option<Self> {
        Some(Self {
            user_id: user.id,
            session_id,
            facility_id: user.facility_id,
            session_version: user.session_version,
            permission_version: user.permission_version,
            active_profile: deployment_profile_claim_value(user.active_profile)?,
        })
    }
}

struct AuthCache {
    max_entries: usize,
    access_clock: AtomicU64,
    users: RwLock<HashMap<AuthCacheKey, CachedValue<AuthUser>>>,
    request_contexts:
        RwLock<HashMap<AuthCacheKey, CachedValue<hms_db::auth::RequestContextAuthFacts>>>,
    hydration_locks: Mutex<HashMap<AuthCacheKey, Arc<tokio::sync::Mutex<()>>>>,
}

struct CachedValue<T> {
    value: T,
    expires_at: Instant,
    last_accessed_tick: AtomicU64,
}

impl AuthCache {
    fn new(max_entries: usize) -> Self {
        Self {
            max_entries,
            access_clock: AtomicU64::new(0),
            users: RwLock::new(HashMap::new()),
            request_contexts: RwLock::new(HashMap::new()),
            hydration_locks: Mutex::new(HashMap::new()),
        }
    }

    fn get_user(&self, key: &AuthCacheKey) -> Option<AuthUser> {
        cache_get(&self.users, key, self.next_access_tick())
    }

    fn put_user(&self, key: AuthCacheKey, user: AuthUser, ttl: Duration) {
        cache_put(
            &self.users,
            key,
            user,
            ttl,
            self.max_entries,
            self.next_access_tick(),
        );
    }

    fn put_user_if_absent(&self, key: AuthCacheKey, user: AuthUser, ttl: Duration) {
        if self.get_user(&key).is_none() {
            self.put_user(key, user, ttl);
        }
    }

    fn get_request_context(
        &self,
        key: &AuthCacheKey,
    ) -> Option<hms_db::auth::RequestContextAuthFacts> {
        cache_get(&self.request_contexts, key, self.next_access_tick())
    }

    fn put_request_context(
        &self,
        key: AuthCacheKey,
        facts: hms_db::auth::RequestContextAuthFacts,
        ttl: Duration,
    ) {
        cache_put(
            &self.request_contexts,
            key,
            facts,
            ttl,
            self.max_entries,
            self.next_access_tick(),
        );
    }

    fn next_access_tick(&self) -> u64 {
        self.access_clock.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn hydration_lock(&self, key: &AuthCacheKey) -> Arc<tokio::sync::Mutex<()>> {
        let Ok(mut locks) = self.hydration_locks.lock() else {
            return Arc::new(tokio::sync::Mutex::new(()));
        };
        if let Some(lock) = locks.get(key) {
            return Arc::clone(lock);
        }
        if locks.len() >= self.max_entries {
            locks.retain(|_, lock| Arc::strong_count(lock) > 1);
        }
        if locks.len() >= self.max_entries {
            return Arc::new(tokio::sync::Mutex::new(()));
        }
        locks
            .entry(key.clone())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    fn remove_user(&self, facility_id: Uuid, user_id: Uuid) {
        if let Ok(mut users) = self.users.write() {
            users.retain(|key, _| key.facility_id != facility_id || key.user_id != user_id);
        }
        if let Ok(mut contexts) = self.request_contexts.write() {
            contexts.retain(|key, _| key.facility_id != facility_id || key.user_id != user_id);
        }
        if let Ok(mut locks) = self.hydration_locks.lock() {
            locks.retain(|key, _| key.facility_id != facility_id || key.user_id != user_id);
        }
    }

    fn remove_session(&self, facility_id: Uuid, user_id: Uuid, session_id: Uuid) {
        if let Ok(mut users) = self.users.write() {
            users.retain(|key, _| {
                key.facility_id != facility_id
                    || key.user_id != user_id
                    || key.session_id != session_id
            });
        }
        if let Ok(mut contexts) = self.request_contexts.write() {
            contexts.retain(|key, _| {
                key.facility_id != facility_id
                    || key.user_id != user_id
                    || key.session_id != session_id
            });
        }
        if let Ok(mut locks) = self.hydration_locks.lock() {
            locks.retain(|key, _| {
                key.facility_id != facility_id
                    || key.user_id != user_id
                    || key.session_id != session_id
            });
        }
    }

    fn remove_facility(&self, facility_id: Uuid) {
        if let Ok(mut users) = self.users.write() {
            users.retain(|key, _| key.facility_id != facility_id);
        }
        if let Ok(mut contexts) = self.request_contexts.write() {
            contexts.retain(|key, _| key.facility_id != facility_id);
        }
        if let Ok(mut locks) = self.hydration_locks.lock() {
            locks.retain(|key, _| key.facility_id != facility_id);
        }
    }
}

struct HotReadCache {
    omni_search: TimedLruCache<OmniSearchCacheKey, OmniSearchResult>,
    dashboard_projection: TimedLruCache<DashboardProjectionCacheKey, DashboardProjectionRead>,
    patient_chronicle_startup:
        TimedLruCache<PatientChronicleStartupCacheKey, ObjectResponse<PatientChronicleStartup>>,
    patient_list: TimedLruCache<PatientListCacheKey, ListResponse<PatientListItem>>,
    pharmacy_dispenses:
        TimedLruCache<PharmacyDispenseCacheKey, ListResponse<PharmacyDispenseListItem>>,
    ward_board: TimedLruCache<WardBoardCacheKey, ListResponse<WardBoardItem>>,
}

impl HotReadCache {
    fn new(max_entries: usize) -> Self {
        Self {
            omni_search: TimedLruCache::new(max_entries),
            dashboard_projection: TimedLruCache::new(max_entries),
            patient_chronicle_startup: TimedLruCache::new(max_entries),
            patient_list: TimedLruCache::new(max_entries),
            pharmacy_dispenses: TimedLruCache::new(max_entries),
            ward_board: TimedLruCache::new(max_entries),
        }
    }
}

struct TimedLruCache<K, V> {
    max_entries: usize,
    access_clock: AtomicU64,
    entries: RwLock<HashMap<K, CachedValue<V>>>,
    hydration_locks: Mutex<HashMap<K, Arc<TokioMutex<()>>>>,
}

impl<K, V> TimedLruCache<K, V>
where
    K: Clone + Eq + Hash,
    V: Clone,
{
    fn new(max_entries: usize) -> Self {
        Self {
            max_entries,
            access_clock: AtomicU64::new(0),
            entries: RwLock::new(HashMap::new()),
            hydration_locks: Mutex::new(HashMap::new()),
        }
    }

    fn get(&self, key: &K) -> Option<V> {
        cache_get(&self.entries, key, self.next_access_tick())
    }

    fn put(&self, key: K, value: V, ttl: Duration) {
        cache_put(
            &self.entries,
            key,
            value,
            ttl,
            self.max_entries,
            self.next_access_tick(),
        );
    }

    fn hydration_lock(&self, key: &K) -> Arc<TokioMutex<()>> {
        let Ok(mut locks) = self.hydration_locks.lock() else {
            return Arc::new(TokioMutex::new(()));
        };
        if locks.len() >= self.max_entries.saturating_mul(2) {
            let now = Instant::now();
            if let Ok(entries) = self.entries.read() {
                locks.retain(|key, lock| {
                    Arc::strong_count(lock) > 1
                        || entries
                            .get(key)
                            .is_some_and(|cached| cached.expires_at > now)
                });
            }
        }
        locks
            .entry(key.clone())
            .or_insert_with(|| Arc::new(TokioMutex::new(())))
            .clone()
    }

    fn clear(&self) {
        if let Ok(mut entries) = self.entries.write() {
            entries.clear();
        }
        if let Ok(mut locks) = self.hydration_locks.lock() {
            locks.clear();
        }
    }

    fn next_access_tick(&self) -> u64 {
        self.access_clock.fetch_add(1, Ordering::Relaxed) + 1
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct OmniSearchCacheKey {
    facility_id: Uuid,
    user_id: Option<Uuid>,
    active_profile: DeploymentProfile,
    query_fingerprint: [u8; 32],
    query_present: bool,
    resource_types: Vec<String>,
    permission_codes: Vec<String>,
    feature_keys: Vec<String>,
    patient_visibility: Vec<String>,
    limit_per_group: i64,
}

impl OmniSearchCacheKey {
    fn new(
        facility_id: Uuid,
        user: &AuthUser,
        query: &Option<String>,
        types: &[SearchResourceType],
        limit_per_group: i64,
    ) -> Self {
        let query_present = query.is_some();
        Self {
            facility_id,
            user_id: (!query_present).then_some(user.id),
            active_profile: user.active_profile,
            query_fingerprint: search_query_fingerprint(query),
            query_present,
            resource_types: enum_scope_key(types),
            permission_codes: enum_scope_key(&user.permissions),
            feature_keys: enum_scope_key(&user.features),
            patient_visibility: enum_scope_key(&user.patient_visibility),
            limit_per_group,
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct DashboardProjectionCacheKey {
    facility_id: Uuid,
    user_id: Uuid,
    session_version: i64,
    permission_version: i64,
    active_profile: DeploymentProfile,
    permission_codes: Vec<String>,
    feature_keys: Vec<String>,
}

impl DashboardProjectionCacheKey {
    fn from_context(facility_id: Uuid, ctx: &hms_access::RequestContext) -> Self {
        Self {
            facility_id,
            user_id: ctx.user_id,
            session_version: ctx.session_version,
            permission_version: ctx.permission_version,
            active_profile: ctx.active_profile,
            permission_codes: enum_scope_key(&ctx.permissions),
            feature_keys: enum_scope_key(&ctx.enabled_features),
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct DashboardRefreshGateKey {
    facility_id: Uuid,
    active_profile: DeploymentProfile,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct PatientChronicleStartupCacheKey {
    facility_id: Uuid,
    user_id: Uuid,
    session_version: i64,
    permission_version: i64,
    active_profile: DeploymentProfile,
    permission_codes: Vec<String>,
    feature_keys: Vec<String>,
    patient_visibility: Vec<String>,
    active_authorities: Vec<String>,
    offsite: String,
    patient_id: Uuid,
    page_size: u8,
}

impl PatientChronicleStartupCacheKey {
    fn new(
        facility_id: Uuid,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        page_size: u8,
    ) -> Self {
        Self {
            facility_id,
            user_id: ctx.user_id,
            session_version: ctx.session_version,
            permission_version: ctx.permission_version,
            active_profile: ctx.active_profile,
            permission_codes: enum_scope_key(&ctx.permissions),
            feature_keys: enum_scope_key(&ctx.enabled_features),
            patient_visibility: enum_scope_key(&ctx.patient_visibility),
            active_authorities: enum_scope_key(&ctx.active_authorities),
            offsite: format!("{:?}", ctx.offsite),
            patient_id,
            page_size,
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct PatientListCacheKey {
    facility_id: Uuid,
    active_profile: DeploymentProfile,
    search_fingerprint: [u8; 32],
    search_present: bool,
    status: Option<String>,
    ordering: String,
    page_size: u8,
}

impl PatientListCacheKey {
    fn new(
        facility_id: Uuid,
        ctx: &hms_access::RequestContext,
        search: Option<&str>,
        status: &Option<PatientAdministrativeStatus>,
        ordering: &str,
        page_size: u8,
    ) -> Self {
        let (search_fingerprint, search_present) = text_filter_fingerprint(search);
        Self {
            facility_id,
            active_profile: ctx.active_profile,
            search_fingerprint,
            search_present,
            status: status.as_ref().map(|value| format!("{value:?}")),
            ordering: ordering.to_owned(),
            page_size,
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct PharmacyDispenseCacheKey {
    facility_id: Uuid,
    user_id: Uuid,
    session_version: i64,
    permission_version: i64,
    active_profile: DeploymentProfile,
    permission_codes: Vec<String>,
    feature_keys: Vec<String>,
    patient_visibility: Vec<String>,
    active_authorities: Vec<String>,
    page_size: u8,
}

impl PharmacyDispenseCacheKey {
    fn new(facility_id: Uuid, ctx: &hms_access::RequestContext, page_size: u8) -> Self {
        Self {
            facility_id,
            user_id: ctx.user_id,
            session_version: ctx.session_version,
            permission_version: ctx.permission_version,
            active_profile: ctx.active_profile,
            permission_codes: enum_scope_key(&ctx.permissions),
            feature_keys: enum_scope_key(&ctx.enabled_features),
            patient_visibility: enum_scope_key(&ctx.patient_visibility),
            active_authorities: enum_scope_key(&ctx.active_authorities),
            page_size,
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct WardBoardCacheKey {
    facility_id: Uuid,
    user_id: Uuid,
    session_version: i64,
    permission_version: i64,
    active_profile: DeploymentProfile,
    permission_codes: Vec<String>,
    ward_id: Option<Uuid>,
    page_size: u8,
}

impl WardBoardCacheKey {
    fn new(
        facility_id: Uuid,
        ctx: &hms_access::RequestContext,
        ward_id: Option<Uuid>,
        page_size: u8,
    ) -> Self {
        Self {
            facility_id,
            user_id: ctx.user_id,
            session_version: ctx.session_version,
            permission_version: ctx.permission_version,
            active_profile: ctx.active_profile,
            permission_codes: enum_scope_key(&ctx.permissions),
            ward_id,
            page_size,
        }
    }
}

#[derive(Default)]
struct DashboardRefreshGate {
    next_allowed_at: Mutex<HashMap<DashboardRefreshGateKey, Instant>>,
}

impl DashboardRefreshGate {
    fn claim(&self, key: DashboardRefreshGateKey, throttle: Duration) -> bool {
        let Ok(mut next_allowed_by_key) = self.next_allowed_at.lock() else {
            return true;
        };
        let now = Instant::now();
        next_allowed_by_key.retain(|_, next_allowed_at| *next_allowed_at > now);
        if next_allowed_by_key
            .get(&key)
            .is_some_and(|next_allowed_at| *next_allowed_at > now)
        {
            return false;
        }
        next_allowed_by_key.insert(key, now + throttle);
        true
    }
}

fn enum_scope_key<T: Debug>(values: &[T]) -> Vec<String> {
    let mut labels = values
        .iter()
        .map(|value| format!("{value:?}"))
        .collect::<Vec<_>>();
    labels.sort();
    labels
}

fn search_query_fingerprint(query: &Option<String>) -> [u8; 32] {
    let mut hasher = Sha256::new();
    match query {
        Some(query) => {
            hasher.update([1]);
            hasher.update(query.as_bytes());
        }
        None => hasher.update([0]),
    }
    hasher.finalize().into()
}

fn text_filter_fingerprint(value: Option<&str>) -> ([u8; 32], bool) {
    let mut hasher = Sha256::new();
    let normalized = value.map(str::trim).filter(|value| !value.is_empty());
    match normalized {
        Some(value) => {
            hasher.update([1]);
            hasher.update(value.to_lowercase().as_bytes());
            (hasher.finalize().into(), true)
        }
        None => {
            hasher.update([0]);
            (hasher.finalize().into(), false)
        }
    }
}

fn cache_get<K, T>(
    cache: &RwLock<HashMap<K, CachedValue<T>>>,
    key: &K,
    access_tick: u64,
) -> Option<T>
where
    K: Clone + Eq + Hash,
    T: Clone,
{
    let now = Instant::now();
    {
        let cache = cache.read().ok()?;
        let cached = cache.get(key)?;
        if cached.expires_at > now {
            cached
                .last_accessed_tick
                .store(access_tick, Ordering::Relaxed);
            return Some(cached.value.clone());
        }
    }

    let mut cache = cache.write().ok()?;
    if cache
        .get(key)
        .is_some_and(|cached| cached.expires_at <= now)
    {
        cache.remove(key);
    }
    None
}

fn cache_put<K, T>(
    cache: &RwLock<HashMap<K, CachedValue<T>>>,
    key: K,
    value: T,
    ttl: Duration,
    max_entries: usize,
    access_tick: u64,
) where
    K: Clone + Eq + Hash,
{
    let Ok(mut cache) = cache.write() else {
        return;
    };
    let now = Instant::now();
    if cache.len() >= max_entries {
        cache.retain(|_, cached| cached.expires_at > now);
        while cache.len() >= max_entries {
            let Some(evict_key) = cache
                .iter()
                .min_by_key(|(_, cached)| {
                    (
                        cached.last_accessed_tick.load(Ordering::Relaxed),
                        cached.expires_at,
                    )
                })
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            cache.remove(&evict_key);
        }
    }
    cache.insert(
        key,
        CachedValue {
            value,
            expires_at: now + ttl,
            last_accessed_tick: AtomicU64::new(access_tick),
        },
    );
}

#[derive(Clone, Debug)]
pub struct LoginOutcome {
    pub access_token: String,
    pub refresh_token: String,
    pub csrf_token: String,
    pub session_id: Uuid,
    pub refresh_expires_at: DateTime<Utc>,
    pub session_idle_expires_at: DateTime<Utc>,
    pub session_absolute_expires_at: DateTime<Utc>,
    pub access_token_expires_in_seconds: u64,
    pub user: AuthUser,
}

#[derive(Clone, Copy, Debug)]
struct SessionDeadlines {
    session_started_at: DateTime<Utc>,
    idle_expires_at: DateTime<Utc>,
    absolute_expires_at: DateTime<Utc>,
    refresh_expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub struct PasswordResetRequestOutcome {
    pub accepted: bool,
    pub debug_token: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AccountSetupDeliveryPurpose {
    StaffAccountSetup,
    StaffPasswordReset,
}

impl AccountSetupDeliveryPurpose {
    fn as_str(self) -> &'static str {
        match self {
            Self::StaffAccountSetup => "staff_account_setup",
            Self::StaffPasswordReset => "staff_password_reset",
        }
    }
}

pub struct StaffAccountSetupDelivery {
    pub purpose: AccountSetupDeliveryPurpose,
    pub staff_id: Uuid,
    pub user_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct AccountSetupDeliveryRecord {
    pub purpose: AccountSetupDeliveryPurpose,
    pub staff_id: Uuid,
    pub user_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub setup_url: String,
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct AccountSetupWebhookPayload<'a> {
    purpose: &'static str,
    facility_code: &'a str,
    staff_id: Uuid,
    user_id: Uuid,
    email: &'a str,
    display_name: &'a str,
    setup_url: &'a str,
    expires_at: DateTime<Utc>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChangePasswordOutcome {
    Changed,
    UserNotFound,
    InvalidCurrentPassword,
    WeakPassword,
    PasswordReused,
}

#[derive(Clone, Debug)]
pub struct DependencyReadiness {
    pub name: String,
    pub ready: bool,
}

#[derive(Clone, Debug)]
pub struct ReadinessSnapshot {
    pub ready: bool,
    pub dependencies: Vec<DependencyReadiness>,
}

impl AppState {
    pub async fn new(config: Config) -> Result<Self> {
        let started_at = Utc::now();
        let auth_cache_max_entries = config.auth_cache_max_entries;
        let password_work_max_concurrency = config.password_work_max_concurrency;
        let pool = hms_db::pool::connect_with_max_connections(
            &config.database_url,
            config.database_max_connections,
        )
        .await
        .context("failed to connect to Postgres")?;
        let auth_pool = hms_db::pool::connect_with_max_connections(
            &config.database_url,
            auth_pool_max_connections(config.database_max_connections),
        )
        .await
        .context("failed to connect to Postgres for auth")?;

        if config.auto_migrate {
            hms_db::migrate::run(&pool)
                .await
                .context("failed to run database migrations")?;
        }

        if config.provision_baseline {
            hms_db::provision::provision_baseline(
                &pool,
                &BaselineProvisioning::hms_local_with_facility_code(
                    config.deployment_profile,
                    config.facility_code.clone(),
                ),
            )
            .await
            .context("failed to provision baseline HMS data")?;
        }

        let facility_id = hms_db::facilities::facility_id_by_code(&pool, &config.facility_code)
            .await?
            .with_context(|| format!("facility {} is not provisioned", config.facility_code))?;

        if config.search_index_rebuild_on_start {
            hms_db::search::rebuild_search_index_for_facility(&pool, facility_id)
                .await
                .context("failed to rebuild OmniSearch index")?;
        }

        warm_hot_read_query_shapes(&pool, facility_id).await;

        let cloudflare_access = if config.ops_auth_mode.allows_cloudflare_access() {
            Some(CloudflareAccessVerifier::new(
                config.cloudflare_access.clone(),
            )?)
        } else {
            None
        };

        Ok(Self {
            inner: Arc::new(AppStateInner {
                config,
                started_at,
                facility_id,
                pool,
                auth_pool,
                auth_cache: AuthCache::new(auth_cache_max_entries),
                hot_read_cache: HotReadCache::new(HOT_READ_CACHE_MAX_ENTRIES),
                password_work_limiter: Arc::new(Semaphore::new(password_work_max_concurrency)),
                dashboard_refresh_gate: DashboardRefreshGate::default(),
                cloudflare_access,
                account_setup_deliveries: Mutex::new(Vec::new()),
            }),
        })
    }

    pub fn started_at(&self) -> DateTime<Utc> {
        self.inner.started_at
    }

    pub fn postgres_pool_size(&self) -> u32 {
        self.inner.pool.size()
    }

    pub fn postgres_pool_idle(&self) -> usize {
        self.inner.pool.num_idle()
    }

    pub fn postgres_pool_max_connections(&self) -> u32 {
        self.inner.config.database_max_connections
    }

    pub fn auth_postgres_pool_size(&self) -> u32 {
        self.inner.auth_pool.size()
    }

    pub fn auth_postgres_pool_idle(&self) -> usize {
        self.inner.auth_pool.num_idle()
    }

    pub fn auth_postgres_pool_max_connections(&self) -> u32 {
        auth_pool_max_connections(self.inner.config.database_max_connections)
    }

    pub fn rum_enabled(&self) -> bool {
        self.inner.config.rum_enabled
    }

    pub fn ops_auth_mode(&self) -> OpsAuthMode {
        self.inner.config.ops_auth_mode
    }

    pub fn ops_prometheus_config(&self) -> &OpsPrometheusConfig {
        &self.inner.config.ops_prometheus
    }

    pub async fn verify_cloudflare_access_operator(
        &self,
        token: &str,
    ) -> Result<CloudflareAccessIdentity, CloudflareAccessError> {
        let verifier = self
            .inner
            .cloudflare_access
            .as_ref()
            .ok_or(CloudflareAccessError::Misconfigured)?;
        verifier.verify(token).await
    }

    pub async fn readiness_snapshot(&self) -> ReadinessSnapshot {
        let mut dependencies = Vec::new();

        let postgres_ready = sqlx::query("SELECT 1")
            .fetch_one(&self.inner.pool)
            .await
            .is_ok();
        dependencies.push(DependencyReadiness {
            name: "postgres".to_owned(),
            ready: postgres_ready,
        });

        if let Some(redis_addr) = &self.inner.config.redis_addr {
            dependencies.push(DependencyReadiness {
                name: "redis".to_owned(),
                ready: redis_ready(redis_addr).await,
            });
        }

        let ready = dependencies.iter().all(|dependency| dependency.ready);
        record_readiness_metrics(ready, &dependencies);

        ReadinessSnapshot {
            ready,
            dependencies,
        }
    }

    pub(crate) fn db_pool(&self) -> &hms_db::PgPool {
        &self.inner.pool
    }

    pub fn facility_id(&self) -> Uuid {
        self.inner.facility_id
    }

    pub fn cookie_secure(&self) -> bool {
        self.inner.config.cookie_secure
    }

    pub fn invalidate_auth_cache_for_user(&self, facility_id: Uuid, user_id: Uuid) {
        self.inner.auth_cache.remove_user(facility_id, user_id);
    }

    pub fn invalidate_auth_cache_for_session(
        &self,
        facility_id: Uuid,
        user_id: Uuid,
        session_id: Uuid,
    ) {
        self.inner
            .auth_cache
            .remove_session(facility_id, user_id, session_id);
    }

    pub fn invalidate_auth_cache_for_facility(&self, facility_id: Uuid) {
        self.inner.auth_cache.remove_facility(facility_id);
    }

    pub fn ensure_account_setup_delivery_available(&self) -> Result<()> {
        match self.inner.config.account_setup_delivery.mode {
            AccountSetupDeliveryMode::Disabled => {
                anyhow::bail!("staff account setup delivery is not configured")
            }
            AccountSetupDeliveryMode::Webhook | AccountSetupDeliveryMode::TestSink => Ok(()),
        }
    }

    pub async fn deliver_staff_account_setup(
        &self,
        delivery: StaffAccountSetupDelivery,
    ) -> Result<()> {
        self.ensure_account_setup_delivery_available()?;
        let setup_url = self.account_setup_url(&delivery.token)?;
        match self.inner.config.account_setup_delivery.mode {
            AccountSetupDeliveryMode::Disabled => {
                anyhow::bail!("staff account setup delivery is not configured")
            }
            AccountSetupDeliveryMode::TestSink => {
                let mut deliveries =
                    self.inner.account_setup_deliveries.lock().map_err(|_| {
                        anyhow::anyhow!("account setup delivery sink is unavailable")
                    })?;
                deliveries.push(AccountSetupDeliveryRecord {
                    purpose: delivery.purpose,
                    staff_id: delivery.staff_id,
                    user_id: delivery.user_id,
                    email: delivery.email,
                    display_name: delivery.display_name,
                    setup_url,
                    token: delivery.token,
                    expires_at: delivery.expires_at,
                });
                Ok(())
            }
            AccountSetupDeliveryMode::Webhook => {
                let webhook_url = self
                    .inner
                    .config
                    .account_setup_delivery
                    .webhook_url
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("account setup webhook is not configured"))?;
                let payload = AccountSetupWebhookPayload {
                    purpose: delivery.purpose.as_str(),
                    facility_code: &self.inner.config.facility_code,
                    staff_id: delivery.staff_id,
                    user_id: delivery.user_id,
                    email: &delivery.email,
                    display_name: &delivery.display_name,
                    setup_url: &setup_url,
                    expires_at: delivery.expires_at,
                };
                let client = reqwest::Client::builder()
                    .timeout(self.inner.config.account_setup_delivery.timeout)
                    .build()?;
                let response = client.post(webhook_url).json(&payload).send().await?;
                if !response.status().is_success() {
                    anyhow::bail!("account setup delivery webhook returned a non-success status");
                }
                Ok(())
            }
        }
    }

    pub fn latest_test_account_setup_delivery(
        &self,
        user_id: Uuid,
        purpose: AccountSetupDeliveryPurpose,
    ) -> Option<AccountSetupDeliveryRecord> {
        if self.inner.config.account_setup_delivery.mode != AccountSetupDeliveryMode::TestSink {
            return None;
        }
        self.inner
            .account_setup_deliveries
            .lock()
            .ok()?
            .iter()
            .rev()
            .find(|delivery| delivery.user_id == user_id && delivery.purpose == purpose)
            .cloned()
    }

    fn account_setup_url(&self, token: &str) -> Result<String> {
        let base = self
            .inner
            .config
            .account_setup_delivery
            .public_app_url
            .as_deref()
            .unwrap_or("http://localhost");
        let mut url = reqwest::Url::parse(base)?;
        url.set_path("/reset-password/confirm");
        url.query_pairs_mut().clear().append_pair("token", token);
        Ok(url.to_string())
    }

    pub async fn omni_search(
        &self,
        user: &AuthUser,
        query: Option<String>,
        types: Vec<SearchResourceType>,
        limit_per_group: i64,
    ) -> Result<OmniSearchResult> {
        let cache_key = OmniSearchCacheKey::new(
            self.inner.facility_id,
            user,
            &query,
            &types,
            limit_per_group,
        );
        if let Some(result) = self.inner.hot_read_cache.omni_search.get(&cache_key) {
            return Ok(result);
        }
        let cache_guard = self
            .inner
            .hot_read_cache
            .omni_search
            .hydration_lock(&cache_key)
            .lock_owned()
            .await;
        if let Some(result) = self.inner.hot_read_cache.omni_search.get(&cache_key) {
            return Ok(result);
        }

        let result = hms_db::search::omni_search(
            &self.inner.pool,
            OmniSearchFilters {
                facility_id: self.inner.facility_id,
                user_id: user.id,
                query,
                types,
                limit_per_group,
                permission_codes: user.permissions.clone(),
                feature_keys: user.features.clone(),
                patient_visibility: user.patient_visibility.clone(),
            },
        )
        .await?;
        self.inner
            .hot_read_cache
            .omni_search
            .put(cache_key, result.clone(), OMNI_SEARCH_CACHE_TTL);
        drop(cache_guard);
        Ok(result)
    }

    pub async fn dashboard_projection(
        &self,
        ctx: &hms_access::RequestContext,
        navigation: NavigationManifest,
    ) -> Result<DashboardProjectionRead> {
        let cache_key = DashboardProjectionCacheKey::from_context(self.inner.facility_id, ctx);
        if let Some(projection) = self
            .inner
            .hot_read_cache
            .dashboard_projection
            .get(&cache_key)
        {
            return Ok(projection);
        }

        let projection = hms_db::dashboard::read_dashboard_projection(
            &self.inner.pool,
            self.inner.facility_id,
            navigation,
        )
        .await?;
        self.inner.hot_read_cache.dashboard_projection.put(
            cache_key,
            projection.clone(),
            DASHBOARD_PROJECTION_CACHE_TTL,
        );
        Ok(projection)
    }

    pub fn claim_dashboard_projection_refresh_enqueue(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> bool {
        self.inner.dashboard_refresh_gate.claim(
            DashboardRefreshGateKey {
                facility_id: self.inner.facility_id,
                active_profile: ctx.active_profile,
            },
            DASHBOARD_REFRESH_QUEUE_THROTTLE,
        )
    }

    pub(crate) fn cached_ward_board(
        &self,
        ctx: &hms_access::RequestContext,
        ward_id: Option<Uuid>,
        page_size: u8,
    ) -> Option<ListResponse<WardBoardItem>> {
        let cache_key = WardBoardCacheKey::new(self.inner.facility_id, ctx, ward_id, page_size);
        self.inner.hot_read_cache.ward_board.get(&cache_key)
    }

    pub(crate) fn put_cached_ward_board(
        &self,
        ctx: &hms_access::RequestContext,
        ward_id: Option<Uuid>,
        page_size: u8,
        response: ListResponse<WardBoardItem>,
    ) {
        let cache_key = WardBoardCacheKey::new(self.inner.facility_id, ctx, ward_id, page_size);
        self.inner
            .hot_read_cache
            .ward_board
            .put(cache_key, response, WARD_BOARD_CACHE_TTL);
    }

    pub(crate) fn invalidate_ward_board_cache(&self) {
        self.inner.hot_read_cache.ward_board.clear();
    }

    pub(crate) fn cached_patient_list(
        &self,
        ctx: &hms_access::RequestContext,
        search: Option<&str>,
        status: &Option<PatientAdministrativeStatus>,
        ordering: &str,
        page_size: u8,
    ) -> Option<ListResponse<PatientListItem>> {
        let cache_key = PatientListCacheKey::new(
            self.inner.facility_id,
            ctx,
            search,
            status,
            ordering,
            page_size,
        );
        self.inner.hot_read_cache.patient_list.get(&cache_key)
    }

    pub(crate) fn put_cached_patient_list(
        &self,
        ctx: &hms_access::RequestContext,
        search: Option<&str>,
        status: &Option<PatientAdministrativeStatus>,
        ordering: &str,
        page_size: u8,
        response: ListResponse<PatientListItem>,
    ) {
        let cache_key = PatientListCacheKey::new(
            self.inner.facility_id,
            ctx,
            search,
            status,
            ordering,
            page_size,
        );
        self.inner
            .hot_read_cache
            .patient_list
            .put(cache_key, response, PATIENT_LIST_CACHE_TTL);
    }

    pub(crate) fn patient_list_cache_lock(
        &self,
        ctx: &hms_access::RequestContext,
        search: Option<&str>,
        status: &Option<PatientAdministrativeStatus>,
        ordering: &str,
        page_size: u8,
    ) -> Arc<TokioMutex<()>> {
        let cache_key = PatientListCacheKey::new(
            self.inner.facility_id,
            ctx,
            search,
            status,
            ordering,
            page_size,
        );
        self.inner
            .hot_read_cache
            .patient_list
            .hydration_lock(&cache_key)
    }

    pub(crate) fn invalidate_patient_list_cache(&self) {
        self.inner.hot_read_cache.patient_list.clear();
    }

    pub(crate) fn cached_patient_chronicle_startup(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        page_size: u8,
    ) -> Option<ObjectResponse<PatientChronicleStartup>> {
        let cache_key = PatientChronicleStartupCacheKey::new(
            self.inner.facility_id,
            ctx,
            patient_id,
            page_size,
        );
        self.inner
            .hot_read_cache
            .patient_chronicle_startup
            .get(&cache_key)
    }

    pub(crate) fn put_cached_patient_chronicle_startup(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        page_size: u8,
        response: ObjectResponse<PatientChronicleStartup>,
    ) {
        let cache_key = PatientChronicleStartupCacheKey::new(
            self.inner.facility_id,
            ctx,
            patient_id,
            page_size,
        );
        self.inner.hot_read_cache.patient_chronicle_startup.put(
            cache_key,
            response,
            PATIENT_CHRONICLE_STARTUP_CACHE_TTL,
        );
    }

    pub(crate) fn patient_chronicle_startup_cache_lock(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        page_size: u8,
    ) -> Arc<TokioMutex<()>> {
        let cache_key = PatientChronicleStartupCacheKey::new(
            self.inner.facility_id,
            ctx,
            patient_id,
            page_size,
        );
        self.inner
            .hot_read_cache
            .patient_chronicle_startup
            .hydration_lock(&cache_key)
    }

    pub(crate) fn invalidate_patient_chronicle_cache(&self) {
        self.inner.hot_read_cache.patient_chronicle_startup.clear();
    }

    pub(crate) fn cached_pharmacy_dispenses(
        &self,
        ctx: &hms_access::RequestContext,
        page_size: u8,
    ) -> Option<ListResponse<PharmacyDispenseListItem>> {
        let cache_key = PharmacyDispenseCacheKey::new(self.inner.facility_id, ctx, page_size);
        self.inner.hot_read_cache.pharmacy_dispenses.get(&cache_key)
    }

    pub(crate) fn put_cached_pharmacy_dispenses(
        &self,
        ctx: &hms_access::RequestContext,
        page_size: u8,
        response: ListResponse<PharmacyDispenseListItem>,
    ) {
        let cache_key = PharmacyDispenseCacheKey::new(self.inner.facility_id, ctx, page_size);
        self.inner.hot_read_cache.pharmacy_dispenses.put(
            cache_key,
            response,
            PHARMACY_DISPENSE_CACHE_TTL,
        );
    }

    pub(crate) fn pharmacy_dispenses_cache_lock(
        &self,
        ctx: &hms_access::RequestContext,
        page_size: u8,
    ) -> Arc<TokioMutex<()>> {
        let cache_key = PharmacyDispenseCacheKey::new(self.inner.facility_id, ctx, page_size);
        self.inner
            .hot_read_cache
            .pharmacy_dispenses
            .hydration_lock(&cache_key)
    }

    pub(crate) fn invalidate_pharmacy_dispense_cache(&self) {
        self.inner.hot_read_cache.pharmacy_dispenses.clear();
    }

    pub fn verify_access_token(
        &self,
        token: &str,
    ) -> Result<AccessClaims, jsonwebtoken::errors::Error> {
        verify_access_token(&self.inner.config.jwt_secret, token)
    }

    pub async fn auth_user(&self, user_id: Uuid) -> Result<Option<AuthUser>> {
        Ok(hms_db::auth::user_by_id(&self.inner.auth_pool, user_id)
            .await?
            .map(|user| user.to_auth_user()))
    }

    pub async fn auth_user_for_facility(
        &self,
        user_id: Uuid,
        facility_id: Uuid,
    ) -> Result<Option<AuthUser>> {
        Ok(
            hms_db::auth::user_by_id_for_facility(&self.inner.auth_pool, user_id, facility_id)
                .await?
                .map(|user| user.to_auth_user()),
        )
    }

    pub async fn auth_user_for_claims(&self, claims: &AccessClaims) -> Result<Option<AuthUser>> {
        if claims.facility_id != self.facility_id() {
            return Ok(None);
        }

        let cache_key = AuthCacheKey::from_claims(claims);
        if let Some(user) = self.cached_auth_user_for_claims(&cache_key, claims) {
            return Ok(Some(user));
        }

        let hydration_lock = self.inner.auth_cache.hydration_lock(&cache_key);
        let _hydration_guard = hydration_lock.lock().await;
        if let Some(user) = self.cached_auth_user_for_claims(&cache_key, claims) {
            return Ok(Some(user));
        }

        let session_user = hms_db::auth::user_by_id_for_facility_session_with_deadline(
            &self.inner.auth_pool,
            claims.sub,
            self.facility_id(),
            claims.session_id,
        )
        .await?;
        let user = session_user
            .as_ref()
            .map(|session_user| session_user.user.to_auth_user());
        if let (Some(user), Some(session_user)) = (&user, &session_user) {
            if auth_user_matches_claims(user, claims) {
                if let Some(ttl) = self.auth_cache_ttl_until(session_user.session_expires_at) {
                    self.inner.auth_cache.put_user(cache_key, user.clone(), ttl);
                }
            }
        }
        Ok(user)
    }

    fn cached_auth_user_for_claims(
        &self,
        cache_key: &AuthCacheKey,
        claims: &AccessClaims,
    ) -> Option<AuthUser> {
        if let Some(user) = self.inner.auth_cache.get_user(cache_key) {
            return Some(user);
        }
        let facts = self.inner.auth_cache.get_request_context(cache_key)?;
        if !auth_user_matches_claims(&facts.user, claims) {
            return None;
        }
        let ttl = self.auth_cache_ttl_until(facts.session_expires_at)?;
        self.inner
            .auth_cache
            .put_user_if_absent(cache_key.clone(), facts.user.clone(), ttl);
        Some(facts.user)
    }

    pub async fn request_context_facts(
        &self,
        user_id: Uuid,
        facility_id: Uuid,
        session_id: Uuid,
    ) -> Result<Option<hms_db::auth::RequestContextAuthFacts>> {
        hms_db::auth::request_context_facts(
            &self.inner.auth_pool,
            user_id,
            facility_id,
            session_id,
            self.inner.config.deployment_profile,
        )
        .await
    }

    pub async fn request_context_facts_for_claims(
        &self,
        claims: &AccessClaims,
        route_pattern: &str,
    ) -> Result<Option<hms_db::auth::RequestContextAuthFacts>> {
        let facility_safe = self.inner.config.facility_code.as_str();
        if claims.facility_id != self.facility_id() {
            hms_observability::record_request_context_cache_miss(route_pattern, facility_safe);
            return Ok(None);
        }

        let cache_key = AuthCacheKey::from_claims(claims);
        if let Some(facts) = self.inner.auth_cache.get_request_context(&cache_key) {
            hms_observability::record_request_context_cache_hit(route_pattern, facility_safe);
            return Ok(Some(facts));
        }

        let hydration_lock = self.inner.auth_cache.hydration_lock(&cache_key);
        let _hydration_guard = hydration_lock.lock().await;
        if let Some(facts) = self.inner.auth_cache.get_request_context(&cache_key) {
            hms_observability::record_request_context_cache_hit(route_pattern, facility_safe);
            return Ok(Some(facts));
        }

        hms_observability::record_request_context_cache_miss(route_pattern, facility_safe);
        let started_at = Instant::now();
        let facts = self
            .request_context_facts(claims.sub, self.facility_id(), claims.session_id)
            .await?;
        hms_observability::record_request_context_hydration_db_time(
            route_pattern,
            facility_safe,
            started_at.elapsed(),
        );
        if let Some(facts) = &facts {
            if auth_user_matches_claims(&facts.user, claims) {
                if let Some(ttl) = self.auth_cache_ttl_until(facts.session_expires_at) {
                    self.inner.auth_cache.put_request_context(
                        cache_key.clone(),
                        facts.clone(),
                        ttl,
                    );
                    self.inner
                        .auth_cache
                        .put_user_if_absent(cache_key, facts.user.clone(), ttl);
                }
            }
        }
        Ok(facts)
    }

    pub async fn active_authorities_for_user(&self, user_id: Uuid) -> Result<Vec<ActiveAuthority>> {
        hms_db::admin::active_authorities_for_user(&self.inner.pool, self.facility_id(), user_id)
            .await
    }

    pub async fn request_context_admin_facts(
        &self,
        user_id: Uuid,
    ) -> Result<hms_db::admin::RequestContextAdminFacts> {
        hms_db::admin::request_context_admin_facts(
            &self.inner.pool,
            self.facility_id(),
            user_id,
            self.inner.config.deployment_profile,
        )
        .await
    }

    pub async fn update_auth_profile(
        &self,
        user_id: Uuid,
        facility_id: Uuid,
        payload: UpdateAuthProfileRequest,
    ) -> Result<Option<AuthUser>> {
        self.invalidate_auth_cache_for_user(facility_id, user_id);
        let user =
            hms_db::auth::update_user_profile(&self.inner.pool, facility_id, user_id, payload)
                .await?
                .map(|user| user.to_auth_user());
        Ok(user)
    }

    pub async fn login(
        &self,
        email: &str,
        password: &str,
        facility_code: &str,
        device_label: Option<&str>,
        request_id: Option<String>,
    ) -> Result<Option<LoginOutcome>> {
        if !self
            .inner
            .config
            .facility_code
            .eq_ignore_ascii_case(facility_code.trim())
        {
            hms_db::auth::insert_login_failure_audit(
                &self.inner.pool,
                NewAuthAuditEvent {
                    facility_id: self.inner.facility_id,
                    actor_user_id: None,
                    request_id,
                    event_type: "auth.login.failed".to_owned(),
                    resource_type: "auth_facility".to_owned(),
                    resource_id: Some(self.inner.facility_id),
                    metadata: serde_json::json!({
                        "severity": "medium",
                        "outcome": "failed",
                        "resolution": "invalid_facility"
                    }),
                },
            )
            .await?;
            return Ok(None);
        }

        let user = hms_db::auth::user_by_email_and_facility(
            &self.inner.pool,
            email.trim(),
            facility_code.trim(),
        )
        .await?;
        let Some(user) = user else {
            hms_db::auth::insert_login_failure_audit(
                &self.inner.pool,
                NewAuthAuditEvent {
                    facility_id: self.inner.facility_id,
                    actor_user_id: None,
                    request_id,
                    event_type: "auth.login.failed".to_owned(),
                    resource_type: "auth_login".to_owned(),
                    resource_id: None,
                    metadata: serde_json::json!({
                        "severity": "medium",
                        "outcome": "failed",
                        "resolution": "unresolved"
                    }),
                },
            )
            .await?;
            return Ok(None);
        };

        if !self
            .verify_password_bounded(&user.password_hash, password)
            .await?
        {
            hms_db::auth::insert_login_failure_audit(
                &self.inner.pool,
                NewAuthAuditEvent {
                    facility_id: user.facility_id,
                    actor_user_id: None,
                    request_id,
                    event_type: "auth.login.failed".to_owned(),
                    resource_type: "auth_user".to_owned(),
                    resource_id: Some(user.id),
                    metadata: serde_json::json!({
                        "severity": "medium",
                        "outcome": "failed"
                    }),
                },
            )
            .await?;
            return Ok(None);
        }

        self.issue_session_for_user(&user, None, None, device_label, None, None, request_id)
            .await
    }

    pub async fn refresh(
        &self,
        refresh_token: &str,
        csrf_token: &str,
        request_id: Option<String>,
    ) -> Result<Option<LoginOutcome>> {
        let token_hash = hash_refresh_token(refresh_token);
        let csrf_token_hash = hash_refresh_token(csrf_token);
        let old_session =
            hms_db::auth::refresh_session_by_token_hash(&self.inner.pool, &token_hash).await?;
        let Some(old_session) = old_session else {
            return Ok(None);
        };

        if old_session.revoked_at.is_some() {
            let _ = hms_db::auth::revoke_refresh_session_family_with_audit(
                &self.inner.pool,
                old_session.session_family_id,
                "refresh_token_reuse_detected",
                NewAuthAuditEvent {
                    facility_id: old_session.facility_id,
                    actor_user_id: None,
                    request_id,
                    event_type: "auth.refresh_token_reuse.detected".to_owned(),
                    resource_type: "auth_session_family".to_owned(),
                    resource_id: Some(old_session.session_family_id),
                    metadata: serde_json::json!({
                        "severity": "high",
                        "subject_user_id": old_session.user_id
                    }),
                },
            )
            .await?;
            self.invalidate_auth_cache_for_user(old_session.facility_id, old_session.user_id);
            warn!(
                session_family_id = %old_session.session_family_id,
                "revoked refresh-session family after refresh token reuse"
            );
            return Ok(None);
        }
        if old_session.expires_at <= Utc::now() {
            return Ok(None);
        }
        if old_session.idle_expires_at <= Utc::now()
            || old_session.absolute_expires_at <= Utc::now()
        {
            return Ok(None);
        }
        if old_session.csrf_token_hash != csrf_token_hash {
            return Ok(None);
        }

        let user = hms_db::auth::user_by_id(&self.inner.pool, old_session.user_id).await?;
        let Some(user) = user else {
            return Ok(None);
        };

        if user.facility_id != old_session.facility_id
            || user.session_version != old_session.session_version
            || user.permission_version != old_session.permission_version_at_issue
        {
            return Ok(None);
        }

        let revoked = hms_db::auth::revoke_refresh_session(
            &self.inner.pool,
            &token_hash,
            &csrf_token_hash,
            "rotated",
        )
        .await?;
        if !revoked {
            return Ok(None);
        }
        self.invalidate_auth_cache_for_session(
            old_session.facility_id,
            old_session.user_id,
            old_session.session_id,
        );

        self.issue_session_for_user(
            &user,
            Some(old_session.session_family_id),
            Some(old_session.session_id),
            old_session.device_label.as_deref(),
            Some(old_session.session_started_at),
            Some(old_session.absolute_expires_at),
            None,
        )
        .await
    }

    pub async fn logout(&self, refresh_token: &str, csrf_token: &str) -> Result<()> {
        let token_hash = hash_refresh_token(refresh_token);
        let csrf_token_hash = hash_refresh_token(csrf_token);
        let session =
            hms_db::auth::refresh_session_by_token_hash(&self.inner.pool, &token_hash).await?;
        let revoked = hms_db::auth::revoke_refresh_session(
            &self.inner.pool,
            &token_hash,
            &csrf_token_hash,
            "logout",
        )
        .await?;
        if revoked {
            if let Some(session) = session {
                self.invalidate_auth_cache_for_session(
                    session.facility_id,
                    session.user_id,
                    session.session_id,
                );
            }
        }
        Ok(())
    }

    pub async fn request_password_reset(
        &self,
        email: &str,
        facility_code: &str,
    ) -> Result<PasswordResetRequestOutcome> {
        if !self
            .inner
            .config
            .facility_code
            .eq_ignore_ascii_case(facility_code.trim())
        {
            return Ok(PasswordResetRequestOutcome {
                accepted: true,
                debug_token: None,
            });
        }

        let Some(user) = hms_db::auth::user_by_email_and_facility(
            &self.inner.pool,
            email.trim(),
            facility_code.trim(),
        )
        .await?
        else {
            return Ok(PasswordResetRequestOutcome {
                accepted: true,
                debug_token: None,
            });
        };

        let raw_token = generate_secret_token();
        let expires_at = Utc::now() + chrono::Duration::minutes(30);
        hms_db::auth::insert_password_reset_token(
            &self.inner.pool,
            &hms_db::auth::NewPasswordResetToken {
                token_hash: hash_refresh_token(&raw_token),
                user_id: user.id,
                facility_id: user.facility_id,
                expires_at,
            },
        )
        .await?;
        hms_db::events::insert_domain_event(
            &self.inner.pool,
            &hms_db::events::NewDomainEvent {
                id: Uuid::new_v4(),
                kind: DomainEventKind::PasswordResetRequested,
                aggregate_type: "user".to_owned(),
                aggregate_id: Some(user.id),
                facility_id: Some(user.facility_id),
                payload: serde_json::json!({}),
            },
        )
        .await?;

        Ok(PasswordResetRequestOutcome {
            accepted: true,
            debug_token: (self.inner.config.environment == "test").then_some(raw_token),
        })
    }

    pub async fn complete_password_reset(&self, token: &str, new_password: &str) -> Result<bool> {
        if !password_meets_policy(new_password) {
            return Ok(false);
        }

        let token_hash = hash_refresh_token(token);
        let Some(reset_token) =
            hms_db::auth::password_reset_token_by_hash(&self.inner.pool, &token_hash).await?
        else {
            return Ok(false);
        };

        if reset_token.used_at.is_some()
            || reset_token.expires_at <= Utc::now()
            || reset_token.facility_id != self.facility_id()
        {
            return Ok(false);
        }

        let previous_hashes =
            hms_db::auth::password_hashes_for_user(&self.inner.pool, reset_token.user_id, 5)
                .await?;
        for hash in &previous_hashes {
            if self.verify_password_bounded(hash, new_password).await? {
                return Ok(false);
            }
        }

        let new_password_hash = self.hash_password_bounded(new_password).await?;
        self.invalidate_auth_cache_for_user(reset_token.facility_id, reset_token.user_id);
        let completed = hms_db::auth::complete_password_reset(
            &self.inner.pool,
            &token_hash,
            reset_token.user_id,
            &new_password_hash,
        )
        .await?;

        if completed {
            self.invalidate_auth_cache_for_user(reset_token.facility_id, reset_token.user_id);
            hms_db::events::insert_domain_event(
                &self.inner.pool,
                &hms_db::events::NewDomainEvent {
                    id: Uuid::new_v4(),
                    kind: DomainEventKind::PasswordResetCompleted,
                    aggregate_type: "user".to_owned(),
                    aggregate_id: Some(reset_token.user_id),
                    facility_id: Some(reset_token.facility_id),
                    payload: serde_json::json!({}),
                },
            )
            .await?;
        }

        Ok(completed)
    }

    pub async fn change_password(
        &self,
        user_id: Uuid,
        facility_id: Uuid,
        current_password: &str,
        new_password: &str,
    ) -> Result<ChangePasswordOutcome> {
        if facility_id != self.facility_id() {
            return Ok(ChangePasswordOutcome::UserNotFound);
        }
        if !password_meets_policy(new_password) {
            return Ok(ChangePasswordOutcome::WeakPassword);
        }

        let Some(user) = hms_db::auth::user_by_id(&self.inner.pool, user_id).await? else {
            return Ok(ChangePasswordOutcome::UserNotFound);
        };
        if user.facility_id != facility_id {
            return Ok(ChangePasswordOutcome::UserNotFound);
        }
        if !self
            .verify_password_bounded(&user.password_hash, current_password)
            .await?
        {
            return Ok(ChangePasswordOutcome::InvalidCurrentPassword);
        }

        let previous_hashes =
            hms_db::auth::password_hashes_for_user(&self.inner.pool, user_id, 5).await?;
        for hash in &previous_hashes {
            if self.verify_password_bounded(hash, new_password).await? {
                return Ok(ChangePasswordOutcome::PasswordReused);
            }
        }

        let new_password_hash = self.hash_password_bounded(new_password).await?;
        self.invalidate_auth_cache_for_user(facility_id, user_id);
        let changed = hms_db::auth::change_user_password(
            &self.inner.pool,
            facility_id,
            user_id,
            &new_password_hash,
        )
        .await?;

        Ok(if changed.is_some() {
            self.invalidate_auth_cache_for_user(facility_id, user_id);
            ChangePasswordOutcome::Changed
        } else {
            ChangePasswordOutcome::UserNotFound
        })
    }

    pub async fn list_auth_sessions(
        &self,
        user_id: Uuid,
        facility_id: Uuid,
        current_session_id: Uuid,
    ) -> Result<Vec<UserSessionRow>> {
        if facility_id != self.facility_id() {
            return Ok(Vec::new());
        }
        hms_db::auth::list_active_user_sessions(
            &self.inner.pool,
            facility_id,
            user_id,
            current_session_id,
            20,
        )
        .await
    }

    pub async fn revoke_auth_session(
        &self,
        user_id: Uuid,
        facility_id: Uuid,
        session_id: Uuid,
    ) -> Result<bool> {
        if facility_id != self.facility_id() {
            return Ok(false);
        }
        let revoked = hms_db::auth::revoke_user_session(
            &self.inner.pool,
            facility_id,
            user_id,
            session_id,
            "user_revoked",
        )
        .await?;
        if revoked {
            self.invalidate_auth_cache_for_session(facility_id, user_id, session_id);
        }
        Ok(revoked)
    }

    pub async fn revoke_other_auth_sessions(
        &self,
        user_id: Uuid,
        facility_id: Uuid,
        current_session_id: Uuid,
    ) -> Result<u64> {
        if facility_id != self.facility_id() {
            return Ok(0);
        }
        let revoked = hms_db::auth::revoke_other_user_sessions(
            &self.inner.pool,
            facility_id,
            user_id,
            current_session_id,
            "user_revoked_others",
        )
        .await?;
        if revoked > 0 {
            self.invalidate_auth_cache_for_user(facility_id, user_id);
        }
        Ok(revoked)
    }

    pub async fn deployment_capabilities(&self) -> Result<DeploymentCapabilities> {
        let features = hms_db::admin::effective_feature_flags(
            &self.inner.pool,
            self.facility_id(),
            self.inner.config.deployment_profile,
        )
        .await?;
        Ok(deployment_capabilities_from_features(
            self.inner.config.deployment_profile,
            self.facility_id(),
            &self.inner.config.facility_code,
            features,
        ))
    }

    fn auth_cache_ttl_until(&self, session_expires_at: DateTime<Utc>) -> Option<Duration> {
        let remaining = session_expires_at
            .signed_duration_since(Utc::now())
            .to_std()
            .ok()?;
        if remaining.is_zero() {
            return None;
        }
        Some(
            remaining
                .min(self.inner.config.access_token_ttl)
                .min(AUTH_CACHE_MAX_TTL),
        )
    }

    fn session_deadlines(
        &self,
        existing_session_started_at: Option<DateTime<Utc>>,
        existing_absolute_expires_at: Option<DateTime<Utc>>,
    ) -> Result<Option<SessionDeadlines>> {
        let now = Utc::now();
        let session_started_at = existing_session_started_at.unwrap_or(now);
        let absolute_expires_at = match existing_absolute_expires_at {
            Some(expires_at) => expires_at,
            None => {
                now + chrono::Duration::from_std(self.inner.config.session_absolute_timeout)
                    .context("session absolute timeout converts to chrono duration")?
            }
        };
        if absolute_expires_at <= now {
            return Ok(None);
        }

        let idle_window_expires_at = now
            + chrono::Duration::from_std(self.inner.config.session_idle_timeout)
                .context("session idle timeout converts to chrono duration")?;
        let idle_expires_at = idle_window_expires_at.min(absolute_expires_at);
        let refresh_window_expires_at = now
            + chrono::Duration::from_std(self.inner.config.refresh_token_ttl)
                .context("refresh token ttl converts to chrono duration")?;
        let refresh_expires_at = refresh_window_expires_at
            .min(idle_expires_at)
            .min(absolute_expires_at);
        if refresh_expires_at <= now {
            return Ok(None);
        }

        Ok(Some(SessionDeadlines {
            session_started_at,
            idle_expires_at,
            absolute_expires_at,
            refresh_expires_at,
        }))
    }

    async fn issue_session_for_user(
        &self,
        user: &UserAccount,
        session_family_id: Option<Uuid>,
        rotated_from_session_id: Option<Uuid>,
        device_label: Option<&str>,
        existing_session_started_at: Option<DateTime<Utc>>,
        existing_absolute_expires_at: Option<DateTime<Utc>>,
        login_request_id: Option<String>,
    ) -> Result<Option<LoginOutcome>> {
        let session_id = Uuid::new_v4();
        let session_family_id = session_family_id.unwrap_or(session_id);
        let refresh_token = generate_secret_token();
        let csrf_token = generate_secret_token();
        let Some(deadlines) =
            self.session_deadlines(existing_session_started_at, existing_absolute_expires_at)?
        else {
            return Ok(None);
        };

        let session = NewRefreshSession {
            token_hash: hash_refresh_token(&refresh_token),
            session_id,
            session_family_id,
            rotated_from_session_id,
            user_id: user.id,
            facility_id: user.facility_id,
            session_version: user.session_version,
            permission_version_at_issue: user.permission_version,
            csrf_token_hash: hash_refresh_token(&csrf_token),
            expires_at: deadlines.refresh_expires_at,
            session_started_at: deadlines.session_started_at,
            idle_expires_at: deadlines.idle_expires_at,
            absolute_expires_at: deadlines.absolute_expires_at,
            device_label: device_label.map(ToOwned::to_owned),
        };
        if let Some(request_id) = login_request_id {
            hms_db::auth::insert_refresh_session_with_audit(
                &self.inner.pool,
                &session,
                NewAuthAuditEvent {
                    facility_id: user.facility_id,
                    actor_user_id: Some(user.id),
                    request_id: Some(request_id),
                    event_type: "auth.login.created".to_owned(),
                    resource_type: "auth_session".to_owned(),
                    resource_id: Some(session_id),
                    metadata: serde_json::json!({
                        "device_label_present": device_label.is_some()
                    }),
                },
            )
            .await?;
        } else {
            hms_db::auth::insert_refresh_session(&self.inner.pool, &session).await?;
        }

        let active_profile = serde_json::to_value(user.active_profile)?
            .as_str()
            .unwrap_or("hospital")
            .to_owned();
        let access_token = issue_access_token(
            &self.inner.config.jwt_secret,
            user.id,
            session_id,
            user.facility_id,
            active_profile,
            user.permission_version,
            user.session_version,
            self.inner.config.access_token_ttl,
        )
        .context("failed to issue access token")?;

        let auth_user = user.to_auth_user();
        if let Some(cache_key) = AuthCacheKey::from_user_account(user, session_id) {
            if let Some(ttl) = self.auth_cache_ttl_until(deadlines.refresh_expires_at) {
                self.inner
                    .auth_cache
                    .put_user(cache_key.clone(), auth_user.clone(), ttl);
            }
            if let Some(facts) = self
                .request_context_facts(user.id, user.facility_id, session_id)
                .await?
            {
                if let Some(ttl) = self.auth_cache_ttl_until(facts.session_expires_at) {
                    self.inner
                        .auth_cache
                        .put_request_context(cache_key, facts, ttl);
                }
            }
        }

        Ok(Some(LoginOutcome {
            access_token,
            refresh_token,
            csrf_token,
            session_id,
            refresh_expires_at: deadlines.refresh_expires_at,
            session_idle_expires_at: deadlines.idle_expires_at,
            session_absolute_expires_at: deadlines.absolute_expires_at,
            access_token_expires_in_seconds: self.inner.config.access_token_ttl.as_secs(),
            user: auth_user,
        }))
    }

    pub(crate) async fn hash_password_bounded(&self, password: &str) -> Result<String> {
        let permit = self
            .inner
            .password_work_limiter
            .clone()
            .acquire_owned()
            .await
            .context("password work limiter closed")?;
        let password = password.to_owned();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            hash_password(&password)
        })
        .await
        .context("password hash task failed")?
    }

    async fn verify_password_bounded(&self, hash: &str, password: &str) -> Result<bool> {
        let permit = self
            .inner
            .password_work_limiter
            .clone()
            .acquire_owned()
            .await
            .context("password work limiter closed")?;
        let hash = hash.to_owned();
        let password = password.to_owned();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            verify_password(&hash, &password)
        })
        .await
        .context("password verify task failed")
    }
}

fn verify_password(hash: &str, password: &str) -> bool {
    let Ok(hash) = PasswordHash::new(hash) else {
        return false;
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &hash)
        .is_ok()
}

fn auth_user_matches_claims(user: &AuthUser, claims: &AccessClaims) -> bool {
    user.id == claims.sub
        && user.facility_id == claims.facility_id
        && user.session_version == claims.session_version
        && user.permission_version == claims.permission_version
        && deployment_profile_claim_value(user.active_profile).as_deref()
            == Some(claims.active_profile.as_str())
}

fn deployment_profile_claim_value(profile: DeploymentProfile) -> Option<String> {
    serde_json::to_value(profile)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
}

fn auth_pool_max_connections(database_max_connections: u32) -> u32 {
    (database_max_connections / 2)
        .clamp(2, 8)
        .min(database_max_connections.max(1))
}

async fn warm_hot_read_query_shapes(pool: &hms_db::PgPool, facility_id: Uuid) {
    use hms_db::patients::{PatientListOrdering, PatientListSortField, SortDirection};

    let warmup = async {
        hms_db::patients::list_patient_registry(
            pool,
            facility_id,
            None,
            21,
            hms_db::patients::PatientRegistryFilters::default(),
            hms_db::patients::PatientListOrdering::default(),
        )
        .await?;
        hms_db::patients::list_patient_registry(
            pool,
            facility_id,
            None,
            21,
            hms_db::patients::PatientRegistryFilters {
                search: Some("hms".to_owned()),
                ..Default::default()
            },
            hms_db::patients::PatientListOrdering::default(),
        )
        .await?;
        let registry_sort_warmups = [
            PatientListSortField::PatientCode,
            PatientListSortField::DisplayName,
            PatientListSortField::DateOfBirth,
            PatientListSortField::Sex,
            PatientListSortField::Status,
        ];
        for sort_field in registry_sort_warmups {
            for direction in [SortDirection::Asc, SortDirection::Desc] {
                hms_db::patients::list_patient_registry(
                    pool,
                    facility_id,
                    None,
                    21,
                    hms_db::patients::PatientRegistryFilters {
                        status: Some(PatientAdministrativeStatus::Active),
                        ..Default::default()
                    },
                    PatientListOrdering {
                        field: sort_field,
                        direction,
                    },
                )
                .await?;
            }
        }
        hms_db::search::omni_search(
            pool,
            OmniSearchFilters {
                facility_id,
                user_id: Uuid::nil(),
                query: Some("General".to_owned()),
                types: vec![
                    SearchResourceType::Patients,
                    SearchResourceType::Appointments,
                    SearchResourceType::Laboratory,
                ],
                limit_per_group: 8,
                permission_codes: vec![
                    PermissionCode::PatientDemographicsView,
                    PermissionCode::AppointmentView,
                    PermissionCode::LaboratoryOrderManage,
                    PermissionCode::LaboratoryResultVerify,
                    PermissionCode::ClinicalDocumentationView,
                ],
                feature_keys: vec![
                    FeatureKey::Patients,
                    FeatureKey::Appointments,
                    FeatureKey::Encounters,
                    FeatureKey::Laboratory,
                ],
                patient_visibility: vec![PatientDataVisibility::Demographics],
            },
        )
        .await?;
        anyhow::Ok(())
    };

    match timeout(HOT_READ_QUERY_SHAPE_WARMUP_TIMEOUT, warmup).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            warn!(error = %error, "hot read query shape warmup failed");
        }
        Err(_) => {
            warn!("hot read query shape warmup timed out");
        }
    }
}

async fn redis_ready(redis_addr: &str) -> bool {
    timeout(Duration::from_millis(500), TcpStream::connect(redis_addr))
        .await
        .map(|result| result.is_ok())
        .unwrap_or(false)
}

fn record_readiness_metrics(ready: bool, dependencies: &[DependencyReadiness]) {
    hms_observability::set_gauge("hms_api_health_ready", bool_as_gauge(ready), &[]);
    for dependency in dependencies {
        hms_observability::set_gauge(
            "hms_api_dependency_ready",
            bool_as_gauge(dependency.ready),
            &[("dependency", dependency.name.as_str())],
        );
    }
}

fn bool_as_gauge(value: bool) -> f64 {
    if value {
        1.0
    } else {
        0.0
    }
}

fn password_meets_policy(password: &str) -> bool {
    password.len() >= 12
        && password.chars().any(char::is_uppercase)
        && password.chars().any(char::is_lowercase)
        && password.chars().any(|value| value.is_ascii_digit())
        && password.chars().any(|value| !value.is_ascii_alphanumeric())
}

pub(crate) fn csrf_compare_hash(token: &str) -> String {
    hash_refresh_token(token)
}
