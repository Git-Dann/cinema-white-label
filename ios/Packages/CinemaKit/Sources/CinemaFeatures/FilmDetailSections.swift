import SwiftUI
import CinemaCore
import CinemaDesign

// Film page sections built from the film's details: Cast (carousel and full list),
// Parents Guide (carousel) and About. Each hides itself when the server sent nothing.

/// Round cast photo with the person's initials while loading or when there is no photo.
struct PersonPhoto: View {
    let person: Film.Person
    let size: CGFloat
    @Environment(\.palette) private var palette

    var body: some View {
        ZStack {
            Circle().fill(palette.surfaceElevated)
            Text(initials).font(.system(size: size * 0.32, weight: .semibold)).foregroundStyle(palette.textMuted)
            if person.photo != nil {
                ArtworkImage(person.photo).clipShape(Circle())
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private var initials: String {
        person.name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
    }
}

/// "Cast >" with a swipeable row of round photos, name and character underneath.
struct CastCarousel: View {
    let people: [Film.Person]
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.header) {
            SectionHeader("Cast") { PeopleListView(people: people) }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: Spacing.item) {
                    ForEach(people) { p in
                        NavigationLink { PeopleListView(people: people, focus: p.id) } label: {
                            VStack(spacing: Spacing.xs) {
                                PersonPhoto(person: p, size: 92)
                                VStack(spacing: 2) {
                                    Text(p.name).font(.subheadline.weight(.semibold)).foregroundStyle(palette.textPrimary)
                                    if let c = p.character { Text(c).font(.footnote).foregroundStyle(palette.textMuted) }
                                }
                                .multilineTextAlignment(.center)
                                .lineLimit(2)
                            }
                            .frame(width: 104)
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(p.character.map { "\(p.name) as \($0)" } ?? p.name)
                    }
                }
                .pagePadding()
            }
            .scrollClipDisabled()
        }
    }
}

/// The whole cast: photo, name, character and a short biography.
struct PeopleListView: View {
    let people: [Film.Person]
    var focus: String?
    @Environment(\.palette) private var palette

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.xl) {
                    ForEach(people) { p in
                        HStack(alignment: .top, spacing: Spacing.m) {
                            PersonPhoto(person: p, size: 72)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).font(.headline).foregroundStyle(palette.textPrimary)
                                if let c = p.character { Text(c).font(.subheadline.weight(.semibold)).foregroundStyle(palette.textSecondary) }
                                if let bio = p.biography {
                                    Text(bio).font(.footnote).foregroundStyle(palette.textMuted).lineLimit(3).padding(.top, 4)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .id(p.id)
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(.vertical, Spacing.m)
                .pagePadding()
            }
            .onAppear { if let focus { proxy.scrollTo(focus, anchor: .top) } }
        }
        .background(palette.background.ignoresSafeArea())
        .navigationTitle("Cast")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Parents Guide: the certificate first, then one card per BBFC category, all in one swipeable row.
struct ParentsGuideCarousel: View {
    let advice: Film.ContentAdvice
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.header) {
            SectionHeader("Parents Guide", subtitle: advice.items.isEmpty ? nil : "BBFC content advice")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.s) {
                    card(title: advice.certificate, detail: advice.meaning ?? "Certificate", dot: nil, large: true)
                        .accessibilityLabel("Certificate \(advice.certificate). \(advice.meaning ?? "")")
                    ForEach(advice.items) { item in
                        card(title: item.category, detail: item.level.rawValue, dot: colour(item.level), large: false)
                            .accessibilityLabel("\(item.category): \(item.text)")
                    }
                }
                .pagePadding()
            }
            .scrollClipDisabled()
        }
    }

    private func card(title: String, detail: String, dot: Color?, large: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(large ? .title3.weight(.bold) : .headline).foregroundStyle(palette.textPrimary).lineLimit(1)
            HStack(spacing: 6) {
                if let dot { Circle().fill(dot).frame(width: 8, height: 8) }
                Text(detail).font(.subheadline).foregroundStyle(palette.textSecondary).lineLimit(1)
            }
        }
        .padding(.horizontal, Spacing.card)
        .frame(minHeight: 72)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous))
        .accessibilityElement(children: .ignore)
    }

    private func colour(_ level: Film.ContentAdvice.Item.Level) -> Color {
        switch level {
        case .strong: palette.error
        case .moderate: palette.warning
        case .mild: palette.success
        case .contains: palette.textMuted
        }
    }
}

/// About: label over value with a thin rule beside each, then genres and keywords as tags.
struct FilmAboutSection: View {
    let film: Film
    let releaseDate: String
    let runtime: String
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.header) {
            SectionHeader("About")
            VStack(alignment: .leading, spacing: Spacing.s) {
                ForEach(Array(film.crewByJob.enumerated()), id: \.offset) { _, g in
                    row(label: g.names.count > 1 ? plural(g.job) : g.job, value: g.names.joined(separator: ", "))
                }
                row(label: "Release Date", value: releaseDate, highlight: palette.actionPrimary)
                row(label: "Runtime", value: runtime)
                if let a = film.about {
                    if let t = a.originalTitle { row(label: "Original Title", value: t) }
                    if !a.spokenLanguages.isEmpty { row(label: "Spoken Languages", value: a.spokenLanguages.joined(separator: ", ")) }
                    if !a.originCountries.isEmpty { row(label: "Origin", value: a.originCountries.joined(separator: ", ")) }
                    if !a.productionCompanies.isEmpty { row(label: "Production", value: a.productionCompanies.joined(separator: ", ")) }
                    if let s = a.status { row(label: "Status", value: s, highlight: palette.success) }
                }
                if !film.genres.isEmpty { tags(label: "Genres", film.genres, tint: palette.actionPrimary) }
                if let k = film.about?.keywords, !k.isEmpty { tags(label: "Keywords", k, tint: palette.textSecondary) }
                if !film.attributions.isEmpty { row(label: "Artwork", value: film.attributions.joined(separator: "; ")) }
            }
            .pagePadding()
        }
    }

    private func plural(_ job: String) -> String {
        switch job {
        case "Screenplay", "Story": job
        default: job + "s"
        }
    }

    private func rule(_ colour: Color?) -> some View {
        Capsule().fill(colour ?? palette.border).frame(width: 3)
    }

    private func row(label: String, value: String, highlight: Color? = nil) -> some View {
        HStack(alignment: .top, spacing: Spacing.s) {
            rule(highlight)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.subheadline).foregroundStyle(palette.textMuted)
                Text(value).font(.body).foregroundStyle(palette.textPrimary)
            }
            .padding(.vertical, 2)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }

    private func tags(label: String, _ values: [String], tint: Color) -> some View {
        HStack(alignment: .top, spacing: Spacing.s) {
            rule(nil)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(label).font(.subheadline).foregroundStyle(palette.textMuted)
                WrapLayout(spacing: Spacing.xs) {
                    ForEach(values, id: \.self) { v in
                        Text(v)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(tint)
                            .padding(.horizontal, Spacing.s)
                            .padding(.vertical, 6)
                            .background(tint.opacity(0.16), in: Capsule())
                    }
                }
            }
            .padding(.vertical, 2)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(values.joined(separator: ", "))")
    }
}

/// Lays children out left to right, wrapping onto new lines (tags).
struct WrapLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for i in row.indices {
                let size = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for i in subviews.indices {
            let size = subviews[i].sizeThatFits(.unspecified)
            let extra = rows[rows.count - 1].indices.isEmpty ? size.width : rows[rows.count - 1].width + spacing + size.width
            if extra > width, !rows[rows.count - 1].indices.isEmpty {
                rows.append(Row(indices: [i], width: size.width, height: size.height))
            } else {
                rows[rows.count - 1].indices.append(i)
                rows[rows.count - 1].width = extra
                rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
            }
        }
        return rows.filter { !$0.indices.isEmpty }
    }
}
