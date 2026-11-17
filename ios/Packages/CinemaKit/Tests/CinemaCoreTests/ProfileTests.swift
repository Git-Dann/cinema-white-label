import Foundation
import Testing
@testable import CinemaCore

@Suite("Profile avatar")
struct ProfileTests {
    let plus = MembershipPlan(id: "plus", name: "Northlight Plus", description: "", priceMinor: 699, interval: "month", entitlements: .init())
    let premiere = MembershipPlan(id: "premiere", name: "Northlight Premiere", description: "", priceMinor: 1499, interval: "month", entitlements: .init())

    func member(_ plan: MembershipPlan, status: String = "active") -> Membership {
        Membership(plan: plan, status: status, startedAt: .now, currentPeriodEnd: .now.addingTimeInterval(86_400))
    }

    @Test func ranksTheTopPlanAsPremium() {
        #expect(AvatarTier(membership: nil, plans: [plus, premiere]) == .guest)
        #expect(AvatarTier(membership: member(plus), plans: [plus, premiere]) == .member(planName: "Northlight Plus"))
        #expect(AvatarTier(membership: member(premiere), plans: [plus, premiere]).isPremium)
        // A lapsed membership is a guest; a single plan is never "premium".
        #expect(AvatarTier(membership: member(premiere, status: "expired"), plans: [plus, premiere]) == .guest)
        #expect(!AvatarTier(membership: member(plus), plans: [plus]).isPremium)
    }

    @Test func tagsTheAvatarWithTheShortPlanName() {
        #expect(AvatarTier.member(planName: "Northlight Plus").tag(operatorWordmark: "Northlight") == "PLUS")
        #expect(AvatarTier.premium(planName: "ODEON Limitless").tag(operatorWordmark: "Odeon") == "LIMITLESS")
        #expect(AvatarTier.member(planName: "Unlimited Membership").tag(operatorWordmark: "Kestrel") == "UNLIMITED")
        #expect(AvatarTier.member(planName: "Northlighters").tag(operatorWordmark: "Northlight") == "NORTHLIGHTERS")
        #expect(AvatarTier.guest.tag(operatorWordmark: "Northlight") == nil)
    }

    @Test func keepsOnePhotoOnThisDevice() throws {
        let store = ProfilePhotoStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        #expect(store.load() == nil)
        try store.save(Data([0xFF, 0xD8, 0xFF]))
        #expect(store.load() == Data([0xFF, 0xD8, 0xFF]))
        #expect(throws: ProfilePhotoStore.PhotoError.tooLarge) { try store.save(Data(count: ProfilePhotoStore.maxBytes + 1)) }
        store.remove()
        #expect(store.load() == nil)
    }
}

@Suite("Membership plans list")
struct MembershipPlanListTests {
    let plans = [
        MembershipPlan(id: "premiere", name: "Premiere", description: "", priceMinor: 1499, interval: "month", entitlements: .init()),
        MembershipPlan(id: "plus", name: "Plus", description: "", priceMinor: 699, interval: "month", entitlements: .init()),
        MembershipPlan(id: "annual", name: "Annual", description: "", priceMinor: 6900, interval: "year", entitlements: .init()),
    ]

    @Test func listsOtherPlansCheapestFirst() {
        #expect(plans.others(than: plans[0]).map(\.id) == ["plus", "annual"])
        #expect(plans.others(than: nil).map(\.id) == ["plus", "premiere", "annual"])
        #expect(plans.byPrice.map(\.id) == ["plus", "premiere", "annual"])
    }
}
