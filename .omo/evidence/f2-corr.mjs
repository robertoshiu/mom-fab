import { deriveTickSeed } from '../../engine/prng.js';
const A=[],B=[];
for(let tick=0;tick<100;tick++){
  const ra=deriveTickSeed('spc.xbar',tick);
  const rb=deriveTickSeed('defect.xy',tick);
  A.push(ra());
  B.push(rb());
}
function corr(x,y){const n=x.length;const mx=x.reduce((a,b)=>a+b)/n,my=y.reduce((a,b)=>a+b)/n;let num=0,dx=0,dy=0;for(let i=0;i<n;i++){const a=x[i]-mx,b=y[i]-my;num+=a*b;dx+=a*a;dy+=b*b;}return num/Math.sqrt(dx*dy);}
const r=corr(A,B);
console.log('r (1 draw/tick, n=100) =', r.toFixed(4), Math.abs(r)<0.1?'PASS':'FAIL');
const A2=[],B2=[];
for(let tick=0;tick<100;tick++){const ra=deriveTickSeed('spc.xbar',tick);const rb=deriveTickSeed('defect.xy',tick);for(let k=0;k<5;k++){A2.push(ra());B2.push(rb());}}
const r2=corr(A2,B2);
console.log('r (5 draws/tick, n=500) =', r2.toFixed(4), Math.abs(r2)<0.1?'PASS':'FAIL');
