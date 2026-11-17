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

@Suite("Customer profile")
struct CustomerProfileTests {
    @Test func tidiesLikeTheServer() {
        let p = CustomerProfile(givenName: "  Dan ", familyName: "", email: " Dan@Example.com", phone: "07700 900123").tidied()
        #expect(p.givenName == "Dan" && p.familyName == nil && p.email == "dan@example.com")
        #expect(p.fullName == "Dan" && p.initials == "D")
        #expect(CustomerProfile(givenName: "Dan", familyName: "lindsay").initials == "DL")
        #expect(CustomerProfile(givenName: " ", email: "").isEmpty)
        #expect(!CustomerProfile(phone: "07700 900123").isEmpty)
    }

    @Test func explainsWhatNeedsFixing() {
        #expect(CustomerProfile(email: "dan@example.com", phone: "+44 7700 900123").problems().isEmpty)
        #expect(CustomerProfile(email: "dan@").problems()[.email] != nil)
        #expect(CustomerProfile(phone: "call me").problems()[.phone] != nil)
        #expect(CustomerProfile(marketingOptIn: true).problems()[.marketingOptIn] == "Add an email address to get offers by email")
        #expect(CustomerProfile(givenName: String(repeating: "a", count: 61)).problems()[.givenName] != nil)
    }

    @Test func sendsEveryFieldSoTheServerCanClearOne() throws {
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(ProfileBody(CustomerProfile(givenName: "Dan")))) as! [String: Any]
        #expect(Set(json.keys) == ["givenName", "familyName", "email", "phone", "marketingOptIn"])
        #expect(json["email"] is NSNull)
    }

    @Test func decodesTheServerCopy() throws {
        let json = #"{"givenName":"Dan","familyName":null,"email":"dan@example.com","phone":null,"marketingOptIn":true,"updatedAt":"2026-11-17T15:00:00.000Z"}"#
        let p = try APIClient.decoder.decode(CustomerProfile.self, from: Data(json.utf8))
        #expect(p.givenName == "Dan" && p.marketingOptIn && p.updatedAt != nil)
        #expect(p.details.updatedAt == nil)
    }

    @Test func keepsTheProfileOnThisDevice() throws {
        let store = ProfileStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        #expect(store.load() == .empty)
        try store.save(CustomerProfile(givenName: " Dan ", email: "DAN@example.com"))
        #expect(store.load().givenName == "Dan" && store.load().email == "dan@example.com")
        store.clear()
        #expect(store.load() == .empty)
    }
}
