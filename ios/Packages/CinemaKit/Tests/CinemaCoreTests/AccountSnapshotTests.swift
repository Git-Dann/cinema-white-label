import Foundation
import Testing
@testable import CinemaCore

@Suite("Account snapshot cache")
struct AccountSnapshotTests {
    let program = LoyaltyProgramInfo(name: "Northlight Rewards", earnPointsPerPound: 10, redeemPointsPerPound: 100, minRedeemPoints: 500)

    @Test func failedRefreshKeepsWhatWeHad() {
        let plans = PreviewFixtures.membershipPlans
        let member = Membership(plan: plans[0], status: "active", startedAt: Date(), currentPeriodEnd: Date().addingTimeInterval(86400))
        let had = AccountSnapshot(loyalty: LoyaltySummary(program: program, points: 420, valueMinor: 400, history: []),
                                  membership: member, membershipPlans: plans)
        #expect(had.merging(loyalty: nil, membership: nil, plans: nil) == had)
    }

    @Test func serverSayingNoMembershipClearsIt() {
        let plans = PreviewFixtures.membershipPlans
        let member = Membership(plan: plans[0], status: "active", startedAt: Date(), currentPeriodEnd: Date().addingTimeInterval(86400))
        let had = AccountSnapshot(membership: member, membershipPlans: plans)
        let next = had.merging(loyalty: nil, membership: .some(nil), plans: [])
        #expect(next.membership == nil)
        #expect(next.membershipPlans.isEmpty)
    }

    @Test func roundTripsThroughDisk() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("account-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = AccountSnapshotStore(cacheDirectory: dir, tenantSlug: "northlight")
        #expect(store.load() == nil)
        let plans = PreviewFixtures.membershipPlans
        let member = Membership(plan: plans[1], status: "active", startedAt: Date(timeIntervalSince1970: 1_800_000_000),
                                currentPeriodEnd: Date(timeIntervalSince1970: 1_802_592_000))
        let snapshot = AccountSnapshot(loyalty: LoyaltySummary(program: program, points: 1250, valueMinor: 1200, history: []),
                                       membership: member, membershipPlans: plans)
        store.save(snapshot)
        #expect(store.load() == snapshot)
    }
}
