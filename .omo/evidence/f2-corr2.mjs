import { deriveTickSeed } from '../../engine/prng.js';
function corr(x,y){const n=x.length;const mx=x.reduce((a,b)=>a+b)/n,my=y.reduce((a,b)=>a+b)/n;let num=0,dx=0,dy=0;for(let i=0;i<n;i++){const a=x[i]-mx,b=y[i]-my;num+=a*b;dx+=a*a;dy+=b*b;}return num/Math.sqrt(dx*dy);}
// Multiple domain pairings to show -0.155 is noise, not structural
const pairs=[['spc.xbar','defect.xy'],['spc.r','defect.density'],['apc.r2r','yield.pareto'],['mes.flow','scm.po']];
for(const [d1,d2] of pairs){
  const A=[],B=[];
  for(let t=0;t<100;t++){A.push(deriveTickSeed(d1,t)());B.push(deriveTickSeed(d2,t)());}
  console.log(`${d1} vs ${d2}: r=${corr(A,B).toFixed(4)}`);
}
// Same domain different tick autocorrelation should also be ~0
const X=[],Y=[];
for(let t=0;t<100;t++){const r=deriveTickSeed('spc.xbar',t);X.push(r());Y.push(r());}
console.log('within-stream consecutive draws r=', corr(X,Y).toFixed(4));
