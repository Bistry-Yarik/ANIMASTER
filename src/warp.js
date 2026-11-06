import {quadMatrix,projectPoint,validCorners} from './engine.js';

// Piecewise affine textured triangles approximate a perspective transform.
// The ordinary (unwarped) path never allocates a mesh.
export function drawWarp(target,source,corners,bounds={x:0,y:0,w:960,h:540}){
 if(!validCorners(corners))return;
 const m=quadMatrix(corners,bounds);if(!m)return;
 target.save();target.beginPath();corners.forEach((p,i)=>i?target.lineTo(p.x,p.y):target.moveTo(p.x,p.y));target.closePath();target.clip();
 if(Math.abs(m[6])+Math.abs(m[7])<1e-10){target.save();target.transform(m[0],m[3],m[1],m[4],m[2],m[5]);target.drawImage(source,0,0,960,540);target.restore();target.restore();return;}
 const steps=12,points=[];
 for(let y=0;y<=steps;y++)for(let x=0;x<=steps;x++){const p={x:bounds.x+x*bounds.w/steps,y:bounds.y+y*bounds.h/steps};points.push({source:p,destination:projectPoint(p,m)});}
 for(let y=0;y<steps;y++)for(let x=0;x<steps;x++){
  const a=points[y*(steps+1)+x],b=points[y*(steps+1)+x+1],c=points[(y+1)*(steps+1)+x+1],d=points[(y+1)*(steps+1)+x];
  triangle(target,source,[a,b,c]);triangle(target,source,[a,c,d]);
 }
 target.restore();
}
function triangle(ctx,image,vertices){
 const [a,b,c]=vertices.map(v=>v.source),[p,q,r]=vertices.map(v=>v.destination);
 const den=a.x*(b.y-c.y)+b.x*(c.y-a.y)+c.x*(a.y-b.y);if(!den)return;
 const x=[p.x,q.x,r.x],y=[p.y,q.y,r.y],coef=v=>[(v[0]*(b.y-c.y)+v[1]*(c.y-a.y)+v[2]*(a.y-b.y))/den,(v[0]*(c.x-b.x)+v[1]*(a.x-c.x)+v[2]*(b.x-a.x))/den,(v[0]*(b.x*c.y-c.x*b.y)+v[1]*(c.x*a.y-a.x*c.y)+v[2]*(a.x*b.y-b.x*a.y))/den];
 const [aa,cc,ee]=coef(x),[bb,dd,ff]=coef(y);
 ctx.save();ctx.beginPath();
 // Tiny overlap avoids hairline cracks between adjacent textured triangles.
 const center={x:(p.x+q.x+r.x)/3,y:(p.y+q.y+r.y)/3};
 [p,q,r].forEach((v,i)=>{const length=Math.hypot(v.x-center.x,v.y-center.y)||1,xx=v.x+(v.x-center.x)/length*.12,yy=v.y+(v.y-center.y)/length*.12;i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);});
 ctx.closePath();ctx.clip();ctx.transform(aa,bb,cc,dd,ee,ff);ctx.drawImage(image,0,0,960,540);ctx.restore();
}
