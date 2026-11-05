# Apple integrations

| Capability | Status | Notes |
|---|---|---|
| Wallet event tickets | Boundary built, demo state | `WalletPassIssuer` builds `pass.json`; `DemoWalletPassIssuer` returns `demo_unsigned` and the app explains it. Real issuing needs a Pass Type ID certificate + WWDR intermediate, PKCS#7 manifest signing and the PassKit web service. The app only shows Apple's Add to Wallet button for a signed pass. Barcode = the same signed admission payload as the in-app ticket. |
| Apple Pay | Not enabled | Needs a PSP (Stripe/Adyen/…) sandbox, merchant ID and payment processing certificate. `PaymentProvider` interface ready; StoreKit is not used (cinema tickets are real-world goods). |
| MapKit / Core Location | Built | In-context when-in-use permission, manual search always available, directions handed to Apple Maps. |
| Calendar | Built | `EKEventEditViewController` with write-only access; customer reviews the event. |
| AVKit trailers | Built | Plays only on request; disabled when no licensed source URL. |
| Live Activities / Dynamic Island | Phase 3 | Start on booking, update via APNs, end after the screening; never present mock data as live. |
| Widgets, App Intents, Spotlight | Phase 3 | No silent payments via Siri; admission codes not shown on widgets. |
| Sign in with Apple / passkeys | Phase 3 | Guest sessions today; registration only for account features. |
| App Clips, Watch | Later | Wallet already covers Watch ticket access. |
