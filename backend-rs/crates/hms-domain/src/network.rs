//! Facility network policy and least-privilege current-request decisions.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// Parsed once for runtime proxy trust; bounded parsing for facility changes.
#[derive(Clone, Default)]
pub struct NetworkRanges(Vec<ipnet::IpNet>);
impl std::fmt::Debug for NetworkRanges {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NetworkRanges")
            .field("count", &self.0.len())
            .finish()
    }
}
impl NetworkRanges {
    pub fn parse(values: &[String], allow_empty: bool) -> Result<Self, &'static str> {
        if values.len() > 64 || (!allow_empty && values.is_empty()) {
            return Err("Use between one and 64 explicit CIDR ranges.");
        }
        let mut ranges = std::collections::BTreeMap::new();
        for text in values {
            if text.trim().len() > 43 {
                return Err("Each network must use valid IPv4 or IPv6 CIDR notation.");
            }
            let mut network = text
                .trim()
                .parse::<ipnet::IpNet>()
                .map_err(|_| "Each network must use valid IPv4 or IPv6 CIDR notation.")?
                .trunc();
            if let ipnet::IpNet::V6(v6) = network {
                if let Some(v4) = v6.addr().to_ipv4_mapped() {
                    if v6.prefix_len() >= 96 {
                        network = ipnet::IpNet::V4(
                            ipnet::Ipv4Net::new(v4, v6.prefix_len() - 96)
                                .map_err(|_| "Invalid mapped IPv4 network.")?
                                .trunc(),
                        );
                    }
                }
            }
            if network.prefix_len() == 0 {
                return Err("A network covering every address is not allowed.");
            }
            ranges.insert(network.to_string(), network);
        }
        let ranges: Vec<_> = ranges.into_values().collect();
        if ipnet::IpNet::aggregate(&ranges)
            .iter()
            .any(|network| network.prefix_len() == 0)
        {
            return Err("Ranges covering every address are not allowed.");
        }
        Ok(Self(ranges))
    }
    pub fn canonical(&self) -> Vec<String> {
        self.0.iter().map(ToString::to_string).collect()
    }
    pub fn contains(&self, address: std::net::IpAddr) -> bool {
        let address = match address {
            std::net::IpAddr::V6(v) => v
                .to_ipv4_mapped()
                .map_or(std::net::IpAddr::V6(v), std::net::IpAddr::V4),
            value => value,
        };
        self.0.iter().any(|network| network.contains(&address))
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NetworkOffsiteMode {
    Readonly,
    Deny,
    FreshReauth,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NetworkClassification {
    Onsite,
    Offsite,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NetworkProvenance {
    Direct,
    TrustedProxy,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NetworkDecisionReason {
    Onsite,
    OffsiteReadonly,
    OffsiteDenied,
    OffsiteFreshReauth,
    ReauthRequired,
    PolicyUnconfigured,
    ClientUnknown,
}

/// Contains no address, network ranges, proxy configuration, or raw headers.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NetworkAccessDecision {
    pub classification: NetworkClassification,
    pub provenance: NetworkProvenance,
    pub policy_version: Option<i64>,
    pub mode: Option<NetworkOffsiteMode>,
    pub access_allowed: bool,
    pub read_only: bool,
    pub reauth_required: bool,
    pub reauth_expires_at: Option<DateTime<Utc>>,
    pub evaluated_at: DateTime<Utc>,
    pub reason: NetworkDecisionReason,
}

/// Administrative projection; never include this in ordinary auth decisions.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NetworkPolicy {
    pub configured: bool,
    pub version: i64,
    pub onsite_cidrs: Vec<String>,
    pub offsite_mode: NetworkOffsiteMode,
    pub updated_at: Option<DateTime<Utc>>,
    pub updated_by_user_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NetworkPolicySettings {
    pub policy: NetworkPolicy,
    pub current_access: NetworkAccessDecision,
    /// Eligible to begin the editor; Preview/PUT still require fresh credentials.
    /// A known offsite `fresh_reauth` caller can begin reauthentication here.
    pub can_update: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct NetworkPolicyCandidate {
    pub onsite_cidrs: Vec<String>,
    pub offsite_mode: NetworkOffsiteMode,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NetworkPolicyPreview {
    pub candidate: NetworkPolicyCandidate,
    pub current_connection_retained_onsite: bool,
    /// An unpersisted candidate has no published policy version.
    pub candidate_access: NetworkAccessDecision,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateNetworkPolicyRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
    pub onsite_cidrs: Vec<String>,
    pub offsite_mode: NetworkOffsiteMode,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NetworkPolicyWriteResult {
    pub client_request_id: Uuid,
    /// Exact immutable saved snapshot, including on a later idempotent replay.
    pub policy: NetworkPolicy,
    pub replayed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ranges(values: &[&str]) -> Result<NetworkRanges, &'static str> {
        NetworkRanges::parse(
            &values.iter().map(|v| (*v).to_owned()).collect::<Vec<_>>(),
            false,
        )
    }
    #[test]
    fn canonical_networks_preserve_meaning_and_deduplicate() {
        let r = ranges(&[
            "192.0.2.23/24",
            "192.0.2.0/24",
            "2001:db8::7/64",
            "::ffff:198.51.100.9/120",
        ])
        .unwrap();
        assert_eq!(
            r.canonical(),
            vec!["192.0.2.0/24", "198.51.100.0/24", "2001:db8::/64"]
        );
        assert!(r.contains("::ffff:192.0.2.5".parse().unwrap()));
        assert!(!r.contains("203.0.113.2".parse().unwrap()));
    }
    #[test]
    fn universal_networks_including_split_ranges_are_refused() {
        for value in [
            vec!["0.0.0.0/0"],
            vec!["::/0"],
            vec!["0.0.0.0/1", "128.0.0.0/1"],
            vec!["::/1", "8000::/1"],
            vec!["::ffff:0.0.0.0/96"],
        ] {
            assert!(ranges(&value).is_err());
        }
    }
    #[test]
    fn empty_or_unbounded_configuration_is_never_a_policy() {
        assert!(ranges(&[]).is_err());
        assert!(NetworkRanges::parse(&[], true).unwrap().is_empty());
        assert!(ranges(&["not-a-network"]).is_err());
        assert!(NetworkRanges::parse(&vec!["127.0.0.1/32".into(); 65], true).is_err());
    }
    #[test]
    fn update_contract_rejects_ignored_fields() {
        let value = serde_json::json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"onsite_cidrs":["127.0.0.1/32"],"offsite_mode":"readonly","reason":"Synthetic review","allow_admin_override":true});
        assert!(serde_json::from_value::<UpdateNetworkPolicyRequest>(value).is_err());
    }
}
