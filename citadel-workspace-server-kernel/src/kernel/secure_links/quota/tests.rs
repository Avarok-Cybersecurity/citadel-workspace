use super::*;

fn usage(own_live: u32, pool_used: u32) -> LinkUsage {
    LinkUsage {
        own_live,
        pool_used,
    }
}

fn quota(per_member: Limit, pool: Limit) -> LinkQuota {
    LinkQuota { per_member, pool }
}

/// The draw as it was before limits could be none, over counts only.
fn finite_draw(u: LinkUsage, per_member: u32, pool: u32) -> Option<LinkSource> {
    if u.own_live < per_member {
        Some(LinkSource::Own)
    } else if u.pool_used < pool {
        Some(LinkSource::Pool)
    } else {
        None
    }
}

#[test]
fn finite_limits_draw_exactly_as_before() {
    for per_member in 0..6 {
        for pool in 0..6 {
            for own in 0..8 {
                for used in 0..8 {
                    let u = usage(own, used);
                    let got = u.draw(quota(Limit::At(per_member), Limit::At(pool)));
                    let want = match finite_draw(u, per_member, pool) {
                        Some(source) => Draw::From(source),
                        None => Draw::Exhausted { per_member, pool },
                    };
                    assert_eq!(got, want, "{u:?} of {per_member}/{pool}");
                }
            }
        }
    }
}

#[test]
fn an_unlimited_allowance_never_reaches_the_pool() {
    let q = quota(Limit::Unlimited, Limit::At(0));
    assert_eq!(usage(u32::MAX - 1, 0).draw(q), Draw::From(LinkSource::Own));
}

#[test]
fn an_unlimited_pool_takes_every_link_past_the_allowance() {
    let q = quota(Limit::At(5), Limit::Unlimited);
    assert_eq!(usage(4, 0).draw(q), Draw::From(LinkSource::Own));
    assert_eq!(usage(5, 1_000_000).draw(q), Draw::From(LinkSource::Pool));
}
