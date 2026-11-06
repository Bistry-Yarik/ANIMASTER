# UI translations

`ui.json` maps Russian source text to nine translations, in this order:
English (en), Chinese (zh), Hindi (hi), Spanish (es), French (fr), Arabic (ar), Bengali (bn), Portuguese (pt), Indonesian (id).

Russian remains the source locale. `src/i18n.js` applies translations to interface text and accessibility labels, restores source text on language changes, and keeps user project/layer/text/country names untouched. Country names use Intl.DisplayNames and locale-aware sorting. Tutorials have concise localized instructions. Translations and the selected locale work offline; no translation service is contacted.

Run `npm run build` after editing the catalog. It embeds it into `src/translations.js` and the standalone HTML.
