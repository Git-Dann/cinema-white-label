import SwiftUI
import CinemaCore
import CinemaDesign

// Previews use the same fixture layouts and tenant configs as the backend seed,
// with deterministic availability from PreviewFixtures.

@MainActor
private func previewModel(_ name: PreviewFixtures.LayoutName, occupancy: Double = 0.35, rules: SeatRules = SeatRules(), selecting: [String] = [], zoomOn: String? = nil) -> SeatSelectionModel {
    let screening = PreviewFixtures.screening(name, rules: rules)
    let model = SeatSelectionModel(screening: screening, availability: PreviewFixtures.availability(for: screening, occupancy: occupancy), maxTickets: 10)
    for id in selecting { model.toggle(id) }
    if let id = zoomOn, let seat = model.seat(id) { model.camera = model.geometry.focus(on: seat, size: Vec2(390, 480)) }
    return model
}

private struct SeatMapPreviewHost: View {
    let model: SeatSelectionModel
    var slug = "northlight"
    var body: some View {
        VStack(spacing: 0) {
            SeatMapContainer(model: model, formatters: Formatters())
            SeatLegend(model: model, formatters: Formatters()).padding(.vertical, 10)
        }
        .cinemaTheme(PreviewFixtures.config(slug).theme)
    }
}

#Preview("Standard · Midnight") { SeatMapPreviewHost(model: previewModel(.standard, selecting: ["G-7", "G-8"])) }
#Preview("Curved IMAX · zoomed") { SeatMapPreviewHost(model: previewModel(.curved, selecting: ["H-9"], zoomOn: "H-9")) }
#Preview("Luxe recliners and sofas") { SeatMapPreviewHost(model: previewModel(.luxe, selecting: ["E-1", "E-2"])) }
#Preview("Premiere pods and VIP beds") { SeatMapPreviewHost(model: previewModel(.premiere, occupancy: 0.2, selecting: ["D-3", "D-4"])) }
#Preview("Kestrel · Classic light") {
    SeatMapPreviewHost(model: previewModel(.standard, selecting: ["K-5"]), slug: "kestrel").preferredColorScheme(.light)
}
#Preview("Nearly sold out") { SeatMapPreviewHost(model: previewModel(.standard, occupancy: 1.4)) }
#Preview("Conflict") {
    let m = previewModel(.standard, selecting: ["F-5", "F-6"])
    m.markConflicts(["F-6"])
    return SeatMapPreviewHost(model: m)
}
#Preview("Accessible list") {
    SeatListView(model: previewModel(.premiere, selecting: ["A-W1"]), formatters: Formatters())
        .cinemaTheme(PreviewFixtures.config().theme)
}
#Preview("Large text") {
    SeatMapPreviewHost(model: previewModel(.standard, selecting: ["C-4"]))
        .environment(\.dynamicTypeSize, .accessibility3)
}
