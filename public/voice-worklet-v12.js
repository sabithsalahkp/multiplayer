class PlayVerseVoiceCapture extends AudioWorkletProcessor{
  constructor(){super();this.targetRate=16000;this.chunkFrames=2048;this.blocks=[];this.frames=0;}
  flush(){
    if(this.frames<this.chunkFrames)return;
    const merged=new Float32Array(this.frames);let off=0;for(const block of this.blocks){merged.set(block,off);off+=block.length;}
    this.blocks=[];this.frames=0;
    const ratio=sampleRate/this.targetRate,outLen=Math.max(1,Math.floor(merged.length/ratio)),out=new Int16Array(outLen);let pos=0;
    for(let i=0;i<outLen;i++){const next=Math.min(merged.length,Math.floor((i+1)*ratio));let sum=0,count=0;for(;pos<next;pos++){sum+=merged[pos];count++;}const s=Math.max(-1,Math.min(1,count?sum/count:0));out[i]=s<0?s*32768:s*32767;}
    this.port.postMessage({pcm:out.buffer},[out.buffer]);
  }
  process(inputs,outputs){const input=inputs[0]?.[0];if(input?.length){this.blocks.push(new Float32Array(input));this.frames+=input.length;if(this.frames>=this.chunkFrames)this.flush();}const out=outputs[0]?.[0];if(out)out.fill(0);return true;}
}
registerProcessor('playverse-voice-capture',PlayVerseVoiceCapture);
