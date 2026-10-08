import React from 'react';
import {AbsoluteFill,Audio,Composition,Sequence,registerRoot,staticFile,useCurrentFrame,interpolate,Easing} from 'remotion';
import data from './public/data.json';
const amber='#e8a33d';
function Scene({scene}:{scene:any}){
 const frame=useCurrentFrame(),t=frame/30;
 const entry=interpolate(frame,[0,18],[0,1],{easing:Easing.out(Easing.cubic),extrapolateLeft:'clamp',extrapolateRight:'clamp'});
 const caption=scene.captions.find((c:any)=>t>=c.start&&t<c.end);
 const windowSize=scene.terminal?7:5;
 const offset=scene.terminal?Math.min(Math.max(0,scene.visual.length-windowSize),Math.floor(t/scene.audioSeconds*Math.max(1,scene.visual.length-windowSize+1))):0;
 return <AbsoluteFill style={{background:'radial-gradient(ellipse at 75% 20%,#292018 0%,#0b0c0e 65%)',color:'#f4f2ed',fontFamily:'Arial, sans-serif',padding:76}}>
  <Audio src={staticFile(scene.asset)}/>
  <div style={{display:'flex',justifyContent:'space-between',fontSize:28,color:'#b7b4ac'}}><span style={{color:amber}}>COMMITONCE</span><span>DEVNET ONLY · UNAUDITED</span></div>
  <h1 style={{fontSize:68,letterSpacing:-2,lineHeight:1.08,margin:'36px 0 42px',opacity:entry,transform:`translateY(${(1-entry)*14}px)`}}>{scene.title}</h1>
  <div style={{height:535,border:'1px solid #4b4338',borderRadius:16,background:'#101214',boxShadow:'0 18px 48px #0005',overflow:'hidden',opacity:entry}}>
   <div style={{background:'#222426',padding:'16px 28px',fontSize:28,color:'#c3beb4'}}>{scene.terminal?'Terminal output · genuine capture · excerpted':'Mechanism / evidence / plan'}<span style={{float:'right',color:amber}}>Solana devnet</span></div>
   <div style={{padding:36,fontFamily:scene.terminal?'Consolas, monospace':'Arial, sans-serif',fontSize:scene.terminal?29:43,lineHeight:scene.terminal?1.37:1.65}}>
    {scene.visual.slice(offset,offset+windowSize).map((line:string,i:number)=><div key={i} style={{color:/counter onchain|AlreadyCommitted|count\s+[12]/.test(line)?amber:'#eeebe5',marginBottom:scene.terminal?0:20,whiteSpace:scene.terminal?'pre-wrap':'normal',overflowWrap:'anywhere'}}>{line}</div>)}
   </div>
  </div>
  <div style={{position:'absolute',bottom:94,left:100,right:100,textAlign:'center',fontSize:37,lineHeight:1.3,minHeight:96,color:'#f4f2ed'}}>{caption?.text}</div>
  <div style={{position:'absolute',bottom:31,left:76,right:76,fontSize:25,color:'#a8a397',display:'flex',justifyContent:'space-between'}}><span>Synthetic English narration · recorded devnet evidence</span><span>2026-10-08</span></div>
 </AbsoluteFill>;
}
function Film({id}:{id:'Pitch'|'Demo'}){return <AbsoluteFill>{data.videos[id].scenes.map((s:any,i:number)=><Sequence key={i} from={Math.round(s.start*30)} durationInFrames={Math.round(s.duration*30)} premountFor={30}><Scene scene={s}/></Sequence>)}</AbsoluteFill>}
registerRoot(()=> <>{(['Pitch','Demo'] as const).map(id=><Composition key={id} id={id} component={Film} defaultProps={{id}} durationInFrames={Math.ceil(data.videos[id].duration*30)} fps={30} width={1920} height={1080}/>)}</>);
