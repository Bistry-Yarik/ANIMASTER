// Independent semitone shift after HTMLMediaElement's speed/pitch preservation.
const pitchProcessor=`class AnimasterPitch extends AudioWorkletProcessor {
 static get parameterDescriptors(){return [{name:'ratio',defaultValue:1,minValue:.25,maxValue:4,automationRate:'k-rate'}];}
 constructor(){super();this.buffers=[];this.write=0;this.phase=0;}
 process(inputs,outputs,parameters){const input=inputs[0],output=outputs[0],ratio=parameters.ratio[0],size=16384,window=2048;
  for(let channel=0;channel<output.length;channel++){if(!this.buffers[channel])this.buffers[channel]=new Float32Array(size);const buffer=this.buffers[channel],source=input[channel]||input[0],target=output[channel];let phase=this.phase,write=this.write;
   for(let i=0;i<target.length;i++){buffer[write]=source?.[i]||0;if(Math.abs(ratio-1)<.00001)target[i]=buffer[write];else{const read=p=>{const delay=ratio>1?(1-p)*window:p*window,pos=(write-delay+size)%size,a=Math.floor(pos),t=pos-a;return buffer[a]*(1-t)+buffer[(a+1)%size]*t;},weight=(1-Math.cos(phase*Math.PI*2))/2;target[i]=read(phase)*weight+read((phase+.5)%1)*(1-weight);}phase=(phase+Math.abs(ratio-1)/window)%1;write=(write+1)%size;}
  }this.write=(this.write+(output[0]?.length||128))%size;this.phase=(this.phase+Math.abs(ratio-1)/window*(output[0]?.length||128))%1;return true;
 }
}registerProcessor('animaster-pitch',AnimasterPitch);`;
const pitchModules=new WeakMap();
export async function createPitchNode(context){
 if(!context.audioWorklet)throw Error('AudioWorklet is required for pitch animation');
 if(!pitchModules.has(context)){const url=URL.createObjectURL(new Blob([pitchProcessor],{type:'text/javascript'}));pitchModules.set(context,context.audioWorklet.addModule(url).finally(()=>URL.revokeObjectURL(url)));}
 await pitchModules.get(context);return new AudioWorkletNode(context,'animaster-pitch',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
}
