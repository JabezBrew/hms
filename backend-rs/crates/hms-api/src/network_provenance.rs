//! Socket-derived client provenance. Forwarded headers never establish trust.
//!
//! Runtime configuration supplies the trusted-proxy predicate. A real socket
//! peer must satisfy it before a single bounded X-Forwarded-For field is read.
//! Resolve right-to-left and stop at the first untrusted hop. An absent,
//! ambiguous, malformed, or entirely trusted chain provides no client identity;
//! never substitute the proxy's private address as the client's onsite address.
use std::net::{IpAddr, SocketAddr};

pub(crate) const MAX_FORWARDED_BYTES: usize = 2048;
pub(crate) const MAX_FORWARDED_HOPS: usize = 16;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ClientProvenance {
    Direct,
    TrustedProxy,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum UnknownClientReason {
    MissingPeer,
    InvalidAddress,
    MissingForwardedChain,
    AmbiguousForwardedFields,
    MalformedForwardedChain,
    ForwardedChainTooLarge,
    NoUntrustedClientHop,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) struct ResolvedClient {
    address: Option<IpAddr>,
    pub(crate) provenance: ClientProvenance,
    pub(crate) unknown_reason: Option<UnknownClientReason>,
}

// Request context may be debugged during diagnosis. Never print client IPs.
impl std::fmt::Debug for ResolvedClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResolvedClient")
            .field("provenance", &self.provenance)
            .field("unknown_reason", &self.unknown_reason)
            .finish_non_exhaustive()
    }
}

impl ResolvedClient {
    pub(crate) fn address(self) -> Option<IpAddr> {
        self.address
    }

    fn known(address: IpAddr, provenance: ClientProvenance) -> Self {
        Self {
            address: Some(address),
            provenance,
            unknown_reason: None,
        }
    }

    fn unknown(reason: UnknownClientReason) -> Self {
        Self {
            address: None,
            provenance: ClientProvenance::Unknown,
            unknown_reason: Some(reason),
        }
    }
}

/// Canonicalize IPv4-mapped IPv6 before checking either proxy or onsite CIDRs.
pub(crate) fn canonical_address(address: IpAddr) -> IpAddr {
    match address {
        IpAddr::V6(value) => value.to_ipv4_mapped().map_or(IpAddr::V6(value), IpAddr::V4),
        address => address,
    }
}

fn valid_client_address(address: IpAddr) -> bool {
    !address.is_unspecified()
        && !address.is_multicast()
        && !matches!(address, IpAddr::V4(value) if value.is_broadcast())
}

/// `forwarded_fields` contains every X-Forwarded-For field, preserving duplicates.
/// An invalid UTF-8 field must be supplied as an invalid value, never discarded.
/// Other purported client-IP or onsite headers are deliberately not inputs.
pub(crate) fn resolve_client(
    peer: Option<SocketAddr>,
    forwarded_fields: &[&str],
    is_trusted_proxy: impl Fn(IpAddr) -> bool,
) -> ResolvedClient {
    let Some(peer) = peer else {
        return ResolvedClient::unknown(UnknownClientReason::MissingPeer);
    };
    let peer = canonical_address(peer.ip());
    if !valid_client_address(peer) {
        return ResolvedClient::unknown(UnknownClientReason::InvalidAddress);
    }
    if !is_trusted_proxy(peer) {
        // An untrusted caller cannot alter its identity with any header.
        return ResolvedClient::known(peer, ClientProvenance::Direct);
    }
    let field = match forwarded_fields {
        [] => return ResolvedClient::unknown(UnknownClientReason::MissingForwardedChain),
        [field] => *field,
        _ => return ResolvedClient::unknown(UnknownClientReason::AmbiguousForwardedFields),
    };
    if field.len() > MAX_FORWARDED_BYTES {
        return ResolvedClient::unknown(UnknownClientReason::ForwardedChainTooLarge);
    }
    let mut hops = Vec::with_capacity(MAX_FORWARDED_HOPS);
    for text in field.split(',') {
        if hops.len() == MAX_FORWARDED_HOPS {
            return ResolvedClient::unknown(UnknownClientReason::ForwardedChainTooLarge);
        }
        let Ok(address) = text.trim().parse::<IpAddr>() else {
            return ResolvedClient::unknown(UnknownClientReason::MalformedForwardedChain);
        };
        let address = canonical_address(address);
        if !valid_client_address(address) {
            return ResolvedClient::unknown(UnknownClientReason::MalformedForwardedChain);
        }
        hops.push(address);
    }
    for address in hops.into_iter().rev() {
        if !is_trusted_proxy(address) {
            return ResolvedClient::known(address, ClientProvenance::TrustedProxy);
        }
    }
    ResolvedClient::unknown(UnknownClientReason::NoUntrustedClientHop)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(value: &str) -> IpAddr {
        value.parse().unwrap()
    }
    fn peer(value: &str) -> Option<SocketAddr> {
        Some(SocketAddr::new(ip(value), 44000))
    }
    fn trusted(address: IpAddr) -> bool {
        [ip("10.20.0.2"), ip("10.20.0.3"), ip("2001:db8:10::2")].contains(&address)
    }
    fn unknown(result: ResolvedClient, reason: UnknownClientReason) {
        assert_eq!(result.address(), None);
        assert_eq!(result.provenance, ClientProvenance::Unknown);
        assert_eq!(result.unknown_reason, Some(reason));
    }

    #[test]
    fn direct_socket_peer_ignores_spoofed_forwarded_addresses() {
        let result = resolve_client(peer("192.0.2.23"), &["127.0.0.1"], trusted);
        assert_eq!(result.address(), Some(ip("192.0.2.23")));
        assert_eq!(result.provenance, ClientProvenance::Direct);
    }

    #[test]
    fn direct_socket_peer_ignores_even_malformed_or_duplicate_fields() {
        let result = resolve_client(peer("192.0.2.23"), &["bad", "127.0.0.1"], trusted);
        assert_eq!(result.address(), Some(ip("192.0.2.23")));
    }

    #[test]
    fn absent_socket_peer_cannot_be_replaced_by_headers() {
        unknown(
            resolve_client(None, &["127.0.0.1"], trusted),
            UnknownClientReason::MissingPeer,
        );
    }

    #[test]
    fn a_single_client_hop_requires_an_actually_trusted_peer() {
        let result = resolve_client(peer("10.20.0.2"), &["192.0.2.23"], trusted);
        assert_eq!(result.address(), Some(ip("192.0.2.23")));
        assert_eq!(result.provenance, ClientProvenance::TrustedProxy);
    }

    #[test]
    fn rightmost_untrusted_hop_wins_over_spoofed_onsite_prefix() {
        let result = resolve_client(
            peer("10.20.0.2"),
            &["127.0.0.1, 192.0.2.23, 10.20.0.3"],
            trusted,
        );
        assert_eq!(result.address(), Some(ip("192.0.2.23")));
    }

    #[test]
    fn ipv6_client_and_proxy_hops_are_supported() {
        let result = resolve_client(
            peer("2001:db8:10::2"),
            &["2001:db8:20::23, 10.20.0.3"],
            trusted,
        );
        assert_eq!(result.address(), Some(ip("2001:db8:20::23")));
    }

    #[test]
    fn ipv4_mapped_ipv6_addresses_are_canonical_for_both_trust_and_client_checks() {
        let result = resolve_client(
            peer("::ffff:10.20.0.2"),
            &["::ffff:192.0.2.23, ::ffff:10.20.0.3"],
            trusted,
        );
        assert_eq!(result.address(), Some(ip("192.0.2.23")));
        assert_eq!(result.provenance, ClientProvenance::TrustedProxy);
    }

    #[test]
    fn missing_forwarded_header_never_promotes_proxy_address_to_client() {
        unknown(
            resolve_client(peer("10.20.0.2"), &[], trusted),
            UnknownClientReason::MissingForwardedChain,
        );
    }

    #[test]
    fn entirely_trusted_chain_has_no_known_client() {
        unknown(
            resolve_client(peer("10.20.0.2"), &["10.20.0.3, 10.20.0.2"], trusted),
            UnknownClientReason::NoUntrustedClientHop,
        );
    }

    #[test]
    fn duplicate_forwarded_header_fields_are_rejected() {
        unknown(
            resolve_client(peer("10.20.0.2"), &["192.0.2.23", "127.0.0.1"], trusted),
            UnknownClientReason::AmbiguousForwardedFields,
        );
    }

    #[test]
    fn invalid_or_ambiguous_chain_syntax_never_falls_back_to_proxy() {
        for field in [
            "",
            " ",
            "unknown",
            "192.0.2.23:80",
            "[2001:db8::1]",
            "192.0.2.23,,10.20.0.3",
            "192.0.2.23,",
            ",192.0.2.23",
            "127.0.0.1,not-an-ip,192.0.2.23",
            "host.example",
            "192.000.002.023",
        ] {
            unknown(
                resolve_client(peer("10.20.0.2"), &[field], trusted),
                UnknownClientReason::MalformedForwardedChain,
            );
        }
    }

    #[test]
    fn maximum_hop_count_is_bounded_before_additional_allocation() {
        let allowed = vec!["192.0.2.23"; MAX_FORWARDED_HOPS].join(",");
        assert_eq!(
            resolve_client(peer("10.20.0.2"), &[&allowed], trusted).address(),
            Some(ip("192.0.2.23"))
        );
        let oversized = vec!["192.0.2.23"; MAX_FORWARDED_HOPS + 1].join(",");
        unknown(
            resolve_client(peer("10.20.0.2"), &[&oversized], trusted),
            UnknownClientReason::ForwardedChainTooLarge,
        );
    }

    #[test]
    fn oversized_header_is_rejected_before_parsing() {
        let field = " ".repeat(MAX_FORWARDED_BYTES + 1);
        unknown(
            resolve_client(peer("10.20.0.2"), &[&field], trusted),
            UnknownClientReason::ForwardedChainTooLarge,
        );
    }

    #[test]
    fn invalid_socket_and_forwarded_client_addresses_are_unknown() {
        for address in ["0.0.0.0", "::", "224.0.0.1", "ff02::1", "255.255.255.255"] {
            unknown(
                resolve_client(peer(address), &[], trusted),
                UnknownClientReason::InvalidAddress,
            );
            unknown(
                resolve_client(peer("10.20.0.2"), &[address], trusted),
                UnknownClientReason::MalformedForwardedChain,
            );
        }
    }

    #[test]
    fn loopback_is_a_known_direct_address_but_does_not_implicitly_mean_onsite() {
        let result = resolve_client(peer("127.0.0.1"), &[], trusted);
        assert_eq!(result.address(), Some(ip("127.0.0.1")));
        assert_eq!(result.provenance, ClientProvenance::Direct);
        // Facility CIDR policy is a separate required decision.
    }

    #[test]
    fn debug_output_cannot_leak_client_address() {
        let result = resolve_client(peer("192.0.2.23"), &[], trusted);
        assert!(!format!("{result:?}").contains("192.0.2.23"));
    }
}
