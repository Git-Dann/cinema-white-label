import { mediaUrl } from '@/lib/api';
import { bannerLines } from '@/lib/offer-banner';
import { SafeImage } from '@/components/SafeImage';

/**
 * An offer as the app shows it: a photo with one solid headline block, and the
 * text and button underneath. No glows or gradients over the photo; the block
 * carries the words.
 */
export function OfferBanner({ title, body, cta, code, imageUrl, filmTitle, dim }: { title: string; body: string; cta?: string | null; code?: string | null; imageUrl?: string | null; filmTitle?: string | null; dim?: boolean }) {
  const { lead, headline } = bannerLines(title || 'Your offer', filmTitle);
  return (
    <div className={`offer-banner${dim ? ' is-dim' : ''}`}>
      <div className={`offer-banner-art${imageUrl ? '' : ' no-photo'}`}>
        {imageUrl && <SafeImage src={mediaUrl(imageUrl, 780)} alt="" loading="lazy" fallback={<span />} />}
        <div className="offer-banner-block">
          {lead && <span className="offer-banner-lead">{lead}</span>}
          <span className={`offer-banner-headline${headline.length > 12 ? ' long' : ''}`}>{headline}</span>
        </div>
      </div>
      <div className="offer-banner-foot">
        <p>{body || 'What customers get, in a sentence.'}</p>
        {code ? <span className="offer-banner-code">{code}</span> : cta ? <span className="offer-banner-cta">{cta}</span> : null}
      </div>
    </div>
  );
}
