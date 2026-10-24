import { parseTerms, type TermsSpan } from '@/lib/forms/terms-markdown';

/**
 * Renders the Terms & Conditions — page 2 of the paper form.
 *
 * Set in a serif face with justified text and tight leading, because the
 * printed page is a dense legal block and the brief is explicit that the
 * digital form must read like the paper rather than be "improved" into a
 * modern web article.
 *
 * Nothing here is set as HTML. The parser emits data and this emits elements,
 * so the one document in the system that must render exactly as written has no
 * injection surface at all.
 */

function Spans({ spans }: { spans: TermsSpan[] }) {
  return (
    <>
      {spans.map((span, index) =>
        span.bold ? (
          <strong key={index} className="font-semibold">
            {span.text}
          </strong>
        ) : (
          <span key={index}>{span.text}</span>
        ),
      )}
    </>
  );
}

export function TermsBody({ markdown }: { markdown: string }) {
  const blocks = parseTerms(markdown);

  return (
    <div className="font-serif text-[13px] leading-snug text-gray-900">
      {blocks.map((block, index) => {
        if (block.kind === 'title') {
          return (
            <h2
              key={index}
              className="mb-3 text-center text-[15px] font-bold tracking-wide uppercase"
            >
              {block.text}
            </h2>
          );
        }

        if (block.kind === 'heading') {
          return (
            <h3 key={index} className="mt-4 mb-1 text-[13px] font-bold">
              {block.text}
            </h3>
          );
        }

        if (block.kind === 'quote') {
          return (
            <blockquote
              key={index}
              className="my-3 border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
            >
              <Spans spans={block.spans} />
            </blockquote>
          );
        }

        return (
          <p key={index} className="mb-2 text-justify">
            <Spans spans={block.spans} />
          </p>
        );
      })}
    </div>
  );
}
