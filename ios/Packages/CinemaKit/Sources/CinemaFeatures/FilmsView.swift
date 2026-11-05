import SwiftUI
import CinemaCore
import CinemaDesign

/// Films: now showing / coming soon with search.
struct FilmsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @State private var segment: Film.Status = .nowShowing
    @State private var query = ""
    @State private var results: [Film]?

    var body: some View {
        let films = results ?? (segment == .nowShowing ? app.nowShowing : app.comingSoon)
        ScrollView {
            VStack(spacing: Spacing.l) {
                if results == nil {
                    Picker("Show", selection: $segment) {
                        Text("Now Showing").tag(Film.Status.nowShowing)
                        Text("Coming Soon").tag(Film.Status.comingSoon)
                    }
                    .pickerStyle(.segmented)
                    .pagePadding()
                }
                if films.isEmpty {
                    ContentUnavailableView(results == nil ? "No films" : "No results", systemImage: "film", description: Text(results == nil ? "Check back soon." : "Try a different title, actor or director."))
                        .padding(.top, Spacing.xxl)
                }
                PosterGrid(films: films)
            }
            .padding(.vertical, Spacing.xs)
            .padding(.bottom, Spacing.section)
        }
        .background(palette.background)
        .navigationTitle("Films")
        .searchable(text: $query, prompt: "Films, actors, directors")
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard !q.isEmpty else { results = nil; return }
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            results = try? await app.service.films(status: nil, query: q)
        }
        .navigationDestination(for: Film.self) { FilmDetailView(film: $0) }
    }
}

/// The one poster grid: same columns, gaps, corners, badge and title treatment everywhere.
struct PosterGrid: View {
    let films: [Film]
    @Environment(\.palette) private var palette

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 104, maximum: 180), spacing: Spacing.s, alignment: .top)], spacing: Spacing.l) {
            ForEach(films) { film in
                NavigationLink(value: film) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        ArtworkImage(film.poster, fallbackTitle: film.title)
                            .aspectRatio(2 / 3, contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous).strokeBorder(.white.opacity(0.08)))
                            .overlay(alignment: .topTrailing) {
                                if let badge = film.formats.first(where: { $0 != "2D" }) { FormatBadge(badge).padding(Spacing.xs) }
                            }
                        Text(film.title)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(palette.textPrimary)
                            .lineLimit(2, reservesSpace: true)
                    }
                    .accessibilityElement(children: .combine)
                }
                .buttonStyle(.plain)
            }
        }
        .pagePadding()
    }
}
