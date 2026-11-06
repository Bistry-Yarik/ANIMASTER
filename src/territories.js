// Each connected territory has its own flag anchor. Sea is always owner 0.
export function territoryComponents(owners,width,height){
 const seen=new Uint8Array(owners.length),queue=new Int32Array(owners.length),components=[];
 for(let start=0;start<owners.length;start++){
  if(seen[start]||!owners[start])continue;const owner=owners[start];let head=0,tail=1,sumX=0,sumY=0,left=width,right=0,top=height,bottom=0;queue[0]=start;seen[start]=1;
  while(head<tail){const p=queue[head++],x=p%width,y=Math.floor(p/width);sumX+=x+.5;sumY+=y+.5;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
   const visit=n=>{if(!seen[n]&&owners[n]===owner){seen[n]=1;queue[tail++]=n;}};
   if(x>0)visit(p-1);if(x+1<width)visit(p+1);if(y>0)visit(p-width);if(y+1<height)visit(p+width);
  }
  const centroid={x:sumX/tail,y:sumY/tail};let anchor=queue[0],distance=Infinity;
  for(let i=0;i<tail;i++){const p=queue[i],d=(p%width+.5-centroid.x)**2+(Math.floor(p/width)+.5-centroid.y)**2;if(d<distance){anchor=p;distance=d;}}
  const at=Math.floor(centroid.y)*width+Math.floor(centroid.x),center=queue.subarray(0,tail).includes(at)?centroid:{x:anchor%width+.5,y:Math.floor(anchor/width)+.5};
  components.push({owner,pixels:queue.slice(0,tail),center,bounds:{x:left,y:top,w:right-left+1,h:bottom-top+1}});
 }
 return components;
}
export function paintTerritory(owners,land,width,height,a,b,size,owner){
 const radius=size/2,dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,changed=[];
 const x0=Math.max(0,Math.floor(Math.min(a.x,b.x)-radius)),x1=Math.min(width-1,Math.ceil(Math.max(a.x,b.x)+radius)),y0=Math.max(0,Math.floor(Math.min(a.y,b.y)-radius)),y1=Math.min(height-1,Math.ceil(Math.max(a.y,b.y)+radius));
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const p=y*width+x;if(!land[p])continue;const t=length?Math.max(0,Math.min(1,((x+.5-a.x)*dx+(y+.5-a.y)*dy)/length)):0;if((x+.5-a.x-t*dx)**2+(y+.5-a.y-t*dy)**2<=radius*radius&&owners[p]!==owner){owners[p]=owner;changed.push(p);}}
 return changed;
}
export function encodeOwners(owners){const runs=[];let previous=owners[0],count=0;for(const owner of owners){if(owner===previous)count++;else{runs.push(previous,count);previous=owner;count=1;}}if(count)runs.push(previous,count);return runs;}
export function decodeOwners(runs,length,maxOwner){
 if(!Array.isArray(runs)||runs.length%2||runs.length>length*2)throw Error('Некорректные территории');const owners=new Uint16Array(length);let offset=0;
 for(let i=0;i<runs.length;i+=2){const owner=runs[i],count=runs[i+1];if(!Number.isInteger(owner)||owner<0||owner>maxOwner||!Number.isInteger(count)||count<=0||offset+count>length)throw Error('Некорректные территории');owners.fill(owner,offset,offset+count);offset+=count;}if(offset!==length)throw Error('Некорректные территории');return owners;
}
