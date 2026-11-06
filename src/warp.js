import {quadMatrix,validCorners} from './engine.js';

// One inverse perspective lookup per output pixel: no independently blended tiles.
let warpGPU;
function warpRenderer(){
 if(warpGPU!==undefined)return warpGPU;
 const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true});
 if(!gl)return warpGPU=null;
 const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
 try{
  const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,`attribute vec2 position;uniform vec4 viewport;varying vec2 dest;void main(){dest=position;vec2 p=(position-viewport.xy)/viewport.zw;gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0.0,1.0);}`));
  gl.attachShader(program,compile(gl.FRAGMENT_SHADER,`precision highp float;uniform mat3 inverseMap;uniform sampler2D image;varying vec2 dest;void main(){vec3 p=inverseMap*vec3(dest,1.0);vec2 uv=p.xy/p.z/vec2(960.0,540.0);gl_FragColor=texture2D(image,uv);}`));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());const attr=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
  gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
  warpGPU={canvas,gl,program};canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();warpGPU=null;});return warpGPU;
 }catch{gl.getExtension('WEBGL_lose_context')?.loseContext();return warpGPU=null;}
}
function inverseMatrix(m){const [a,b,c,d,e,f,g,h,i]=m,det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);if(Math.abs(det)<1e-12)return null;return [(e*i-f*h)/det,(c*h-b*i)/det,(b*f-c*e)/det,(f*g-d*i)/det,(a*i-c*g)/det,(c*d-a*f)/det,(d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det];}
export function drawWarp(target,source,corners,bounds={x:0,y:0,w:960,h:540}){
 if(!validCorners(corners))return;const m=quadMatrix(corners,bounds),inverse=m&&inverseMatrix(m);if(!inverse)return;
 const left=Math.floor(Math.min(...corners.map(p=>p.x))),top=Math.floor(Math.min(...corners.map(p=>p.y))),w=Math.ceil(Math.max(...corners.map(p=>p.x)))-left,h=Math.ceil(Math.max(...corners.map(p=>p.y)))-top;if(!w||!h)return;
 const t=target.getTransform(),scale=Math.max(1,Math.hypot(t.a,t.b),Math.hypot(t.c,t.d)),resolution=Math.min(scale,4096/w,4096/h),width=Math.max(1,Math.ceil(w*resolution)),height=Math.max(1,Math.ceil(h*resolution));
 const gpu=warpRenderer();if(gpu){const {canvas,gl,program}=gpu;canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(program);
  gl.uniform4f(gl.getUniformLocation(program,'viewport'),left,top,w,h);gl.uniformMatrix3fv(gl.getUniformLocation(program,'inverseMap'),false,new Float32Array([inverse[0],inverse[3],inverse[6],inverse[1],inverse[4],inverse[7],inverse[2],inverse[5],inverse[8]]));
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,1,2,0,2,3].flatMap(i=>[corners[i].x,corners[i].y])),gl.STREAM_DRAW);gl.drawArrays(gl.TRIANGLES,0,6);target.drawImage(canvas,left,top,w,h);return;
 }
 // Software fallback also uses a continuous inverse map and premultiplied interpolation.
 const out=document.createElement('canvas');out.width=width;out.height=height;const g=out.getContext('2d'),pixels=g.createImageData(width,height),sample=source.getContext('2d',{willReadFrequently:true}).getImageData(0,0,960,540).data;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const dx=left+(x+.5)*w/width,dy=top+(y+.5)*h/height,z=inverse[6]*dx+inverse[7]*dy+inverse[8],sx=(inverse[0]*dx+inverse[1]*dy+inverse[2])/z,sy=(inverse[3]*dx+inverse[4]*dy+inverse[5])/z;if(sx<bounds.x||sy<bounds.y||sx>=bounds.x+bounds.w||sy>=bounds.y+bounds.h)continue;
  const xx=sx-.5,yy=sy-.5,x0=Math.floor(xx),y0=Math.floor(yy),fx=xx-x0,fy=yy-y0,rgba=[0,0,0,0];
  for(let j=0;j<2;j++)for(let i=0;i<2;i++){const weight=(i?fx:1-fx)*(j?fy:1-fy),offset=(Math.max(0,Math.min(539,y0+j))*960+Math.max(0,Math.min(959,x0+i)))*4,a=sample[offset+3]/255;rgba[3]+=a*weight;for(let c=0;c<3;c++)rgba[c]+=sample[offset+c]*a*weight;}
  const o=(y*width+x)*4;if(rgba[3]){for(let c=0;c<3;c++)pixels.data[o+c]=rgba[c]/rgba[3];pixels.data[o+3]=rgba[3]*255;}
 }
 g.putImageData(pixels,0,0);target.drawImage(out,left,top,w,h);
}
