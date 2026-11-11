import { mediaUrl, PromotionActionKind } from '@/lib/api';
import { bannerLines, starburstPolygon, stickerLines } from '@/lib/offer-banner';
import { SafeImage } from '@/components/SafeImage';

const STAR = starburstPolygon();

/**
 * An offer as the app shows it, shelf-edge style: the brand colour fills the card,
 * the saving is the biggest thing on it, a starburst sticker on the photo says what
 * to do, and the button is inverted. Mirrors PromotionCard in the app.
 */
export function OfferBanner({ title, body, cta, action, code, imageUrl, filmTitle, dim }: { title: string; body: string; cta?: string | null; action: PromotionActionKind; code?: string | null; imageUrl?: string | null; filmTitle?: string | null; dim?: boolean }) {
  const { lead, headline } = bannerLines(title || 'Your offer', filmTitle);
  const sticker = stickerLines(action, code);
  const button = action === 'voucher' ? cta || 'Show code' : action === 'none' ? null : cta;
  return (
    <div className={`offer-card${dim ? ' is-dim' : ''}`}>
      <div className="offer-card-text">
        {lead && <span className="offer-card-lead">{lead}</span>}
        <span className={`offer-card-headline${headline.length > 9 ? ' long' : ''}`}>{headline}</span>
        <p>{body || 'What customers get, in a sentence.'}</p>
        {button && <span className="offer-card-cta">{button}</span>}
      </div>
      <div className="offer-card-photo">
        {imageUrl && <SafeImage src={mediaUrl(imageUrl, 500)} alt="" loading="lazy" fallback={<span />} />}
        <span className="offer-card-sticker" style={{ clipPath: STAR }}>
          {sticker.map((w, i) => (
            <span key={w} className={i === sticker.length - 1 && sticker.length > 1 ? 'big' : undefined}>
              {w}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
