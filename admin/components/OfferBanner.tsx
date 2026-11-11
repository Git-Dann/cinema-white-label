import { mediaUrl } from '@/lib/api';
import { bannerLines } from '@/lib/offer-banner';
import { SafeImage } from '@/components/SafeImage';

/**
 * An offer as the app shows it: a photo with one solid headline block, and the
 * stub underneath (perforated, with notches) holding the text and the code or
 * button. No glows or gradients over the photo; the block carries the words.
 */
export function OfferBanner({ title, body, cta, code, imageUrl, filmTitle, validTo, dim }: { title: string; body: string; cta?: string | null; code?: string | null; imageUrl?: string | null; filmTitle?: string | null; validTo?: string | null; dim?: boolean }) {
  const { lead, headline } = bannerLines(title || 'Your offer', filmTitle);
  const kind = code ? 'Voucher' : filmTitle ? 'Film offer' : 'Offer';
  const until = validTo ? `Until ${new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(validTo))}` : null;
  return (
    <div className={`offer-banner${dim ? ' is-dim' : ''}`}>
      <div className={`offer-banner-art${imageUrl ? '' : ' no-photo'}`}>
        {imageUrl && <SafeImage src={mediaUrl(imageUrl, 780)} alt="" loading="lazy" fallback={<span />} />}
        <div className="offer-banner-block">
          {lead && <span className="offer-banner-lead">{lead}</span>}
          <span className={`offer-banner-headline${headline.length > 12 ? ' long' : ''}`}>{headline}</span>
        </div>
      </div>
      {/* The tear-off stub, as in the app: notches cut at the perforation. */}
      <div className="offer-banner-foot">
        <div className="offer-banner-text">
          <span className="offer-banner-kind">{[kind, until].filter(Boolean).join(' · ')}</span>
          <p>{body || 'What customers get, in a sentence.'}</p>
        </div>
        {code ? (
          <span className="offer-banner-code">
            <strong>{code}</strong>
            <small>Tap for code</small>
          </span>
        ) : cta ? (
          <span className="offer-banner-cta">{cta}</span>
        ) : null}
      </div>
    </div>
  );
}
