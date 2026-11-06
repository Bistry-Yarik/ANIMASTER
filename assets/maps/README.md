# Map templates

Country outlines: Natural Earth, 1:110m Admin 0 Countries, public domain.
Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson
License: https://www.naturalearthdata.com/about/terms-of-use/

The SVG templates use an equirectangular projection (regional horizontal scale corrected for central latitude), transparent water, and country borders. Europe is a regional crop including adjacent land for context; Africa selects the African country features. World includes Antarctica. All templates are bundled for offline use. These are illustrative map outlines, not navigational data.

Country geometry and per-component bounds for flag filling are stored in countries.json. Standard ISO flag codes are used; Northern Cyprus uses CY and Somaliland uses SO. Flag SVG files and their license are in ../flags. The year control is a numerical annotation and does not automatically simulate historical borders.

Additional templates: North America (including Central America and Caribbean), South America, Asia (including Russia), Eurasia. Regional country lists and extents are stored in regions.json. Run `python scripts/region-maps.py` to regenerate their SVG and country paths from bundled world geometry; no network or Python packages required. Projections preserve the existing world geometry's coordinate precision.
