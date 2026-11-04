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
            VStack(spacing: 16) {
                if results == nil {
                    Picker("Show", selection: $segment) {
                        Text("Now Showing").tag(Film.Status.nowShowing)
                        Text("Coming Soon").tag(Film.Status.comingSoon)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)
                }
                if films.isEmpty {
                    ContentUnavailableView(results == nil ? "No films" : "No results", systemImage: "film", description: Text(results == nil ? "Check back soon." : "Try a different title, actor or director."))
                        .padding(.top, 40)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 104, maximum: 180), spacing: 12)], spacing: 18) {
                    ForEach(films) { film in
                        NavigationLink(value: film) {
                            VStack(alignment: .leading, spacing: 6) {
                                ArtworkImage(film.poster)
                                    .aspectRatio(2 / 3, contentMode: .fit)
                                    .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous))
                                    .overlay(alignment: .topTrailing) {
                                        if film.formats.contains("IMAX") { FormatBadge("IMAX").padding(6) }
                                    }
                                Text(film.title).font(.footnote.weight(.semibold)).foregroundStyle(palette.textPrimary).lineLimit(2)
                            }
                            .accessibilityElement(children: .combine)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
            .padding(.vertical, 8)
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
