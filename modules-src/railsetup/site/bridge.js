window.__rail={get saved(){return saved},set saved(v){saved=v},get adj(){return adj},get radj(){return radj},get HP(){return HP},get HP0(){return HP0},get DEF(){return DEF},get loaded(){return loaded},
setupEls:()=>SETUP_EL,snapshot:n=>snapshot(n),fillLists:()=>fillLists(),useHardpoints:(j,n)=>useHardpoints(j,n),
replaceWriteSaved:f=>{const old=writeSaved;writeSaved=f;return old},replaceUseHardpoints:f=>{const old=useHardpoints;useHardpoints=f;return old}};
