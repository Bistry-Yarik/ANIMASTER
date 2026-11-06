"""Generate additional regional maps from the bundled world geometry (no downloads)."""
import json, math, re
from pathlib import Path
root=Path(__file__).resolve().parents[1]
path=root/'assets/maps/countries.json'
data=json.loads(path.read_text())
# Country lists are selected from Natural Earth's continent classification.
config=json.loads((root/'assets/maps/regions.json').read_text())
for region in config:
    west,south,east,north=region['extent'];cos=math.cos(math.radians((north+south)/2));scale=min(900/((east-west)*cos),480/(north-south));w=(east-west)*cos*scale;h=(north-south)*scale;left=(960-w)/2;top=(540-h)/2
    def project(x,y):
        lon=(x-30)/2.5-180;lat=90-(y-45)/2.5
        return round(left+(lon-west)*cos*scale,2),round(top+(north-lat)*scale,2)
    def project_path(d):
        return re.sub(r'(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)',lambda m:'%.2f,%.2f'%project(float(m[1]),float(m[2])),d)
    def part(p):
        d=project_path(p['d']);pts=[(float(x),float(y)) for x,y in re.findall(r'(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)',d)];xs,ys=zip(*pts)
        return {'d':d,'bounds':dict(x=min(xs),y=min(ys),w=round(max(xs)-min(xs),2),h=round(max(ys)-min(ys),2))}
    countries=[dict(name=c['name'],code=c['code'],**part(c),parts=[part(p) for p in c['parts']]) for c in data['world']['countries'] if c['name'] in region['countries']]
    clip=dict(x=round(left,2),y=round(top,2),w=round(w,2),h=round(h,2));data[region['id']]={'clip':clip,'countries':countries}
    paths=''.join('<path d="'+c['d']+'"/>' for c in countries)
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><defs><clipPath id="land"><rect x="{left}" y="{top}" width="{w}" height="{h}"/></clipPath></defs><g clip-path="url(#land)" fill="#dad7ee" stroke="#57516c" stroke-width="0.7" fill-rule="evenodd">{paths}</g></svg>'
    (root/f"assets/maps/{region['id']}.svg").write_text(svg)
path.write_text(json.dumps(data,separators=(',',':'),ensure_ascii=False)+'\n')
