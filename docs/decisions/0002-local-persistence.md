# 0002 – Local persistence

Tickets and tenant config are cached as JSON files in Application Support with file protection (`completeUntilFirstUserAuthentication`). They are small, read whole, and must open offline in a foyer with no signal; Codable files give that with no schema migrations.

SwiftData becomes worthwhile when the app stores queryable local data (watchlists, large menus offline, loyalty history). The `TicketStore` and `TenantConfigStore` APIs hide storage, so switching later does not affect features.
