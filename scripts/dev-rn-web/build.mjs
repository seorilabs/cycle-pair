import { build } from "esbuild";
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const task = path.dirname(new URL(import.meta.url).pathname);
const source = path.resolve(task, "../..");
const req = createRequire(import.meta.url);
const observedHead = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const candidate = process.env.CYCLEPAIR_CANDIDATE || observedHead;
if (observedHead !== candidate) throw Error("Pinned candidate HEAD changed");
const productPaths = ["apps/mobile", "packages/product-core", "firebase"];
const productDrift = execFileSync(
  "git",
  [
    "-C",
    source,
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ...productPaths,
  ],
  { encoding: "utf8" }
)
  .split("\n")
  .filter((line) => line && !line.endsWith("/node_modules"))
  .join("\n");
const fingerprintPaths = execFileSync(
  "git",
  [
    "-C",
    source,
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ...productPaths,
  ],
  { encoding: "utf8" }
)
  .trim()
  .split("\n")
  .filter(
    (file) =>
      fs.existsSync(path.join(source, file)) &&
      fs.statSync(path.join(source, file)).isFile()
  )
  .sort();
const hash = createHash("sha256");
for (const file of fingerprintPaths) {
  hash.update(file + "\0");
  hash.update(fs.readFileSync(path.join(source, file)));
  hash.update("\0");
}
const sourceFingerprint = hash.digest("hex");
const authorRun = process.argv.includes("--author");
if (productDrift && !authorRun)
  throw Error("Pinned product source changed: " + productDrift);
fs.mkdirSync(path.join(task, "shims"), { recursive: true });
fs.mkdirSync(path.join(task, "dist"), { recursive: true });
const put = (n, t) => fs.writeFileSync(path.join(task, "shims", n), t);
put(
  "scope.ts",
  `export const run=new URLSearchParams(location.search).get('run')||'preflight';export const actor=new URLSearchParams(location.search).get('actor')||'owner';export const prefix='cyclepair-qa:'+run+':'+actor+':';`
);
put(
  "async-storage.ts",
  `import {prefix} from './scope';const api={getItem:async(k:string)=>localStorage.getItem(prefix+'async:'+k),setItem:async(k:string,v:string)=>{localStorage.setItem(prefix+'async:'+k,v)},removeItem:async(k:string)=>{localStorage.removeItem(prefix+'async:'+k)},getAllKeys:async()=>Object.keys(localStorage).filter(k=>k.startsWith(prefix+'async:')).map(k=>k.slice((prefix+'async:').length)),multiRemove:async(keys:string[])=>{keys.forEach(k=>localStorage.removeItem(prefix+'async:'+k))}};export default api;`
);
put(
  "keychain.ts",
  `import {prefix} from './scope';export const ACCESSIBLE={AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:'fixture'};export const STORAGE_TYPE={AES_GCM_NO_AUTH:'fixture'};export async function setGenericPassword(username:string,password:string,{service}:any){localStorage.setItem(prefix+'keychain:'+service,JSON.stringify({username,password}));return {service,storage:'fixture'}}export async function getGenericPassword({service}:any){const t=localStorage.getItem(prefix+'keychain:'+service);return t?{service,storage:'fixture',...JSON.parse(t)}:false}export async function resetGenericPassword({service}:any){localStorage.removeItem(prefix+'keychain:'+service);return true}export async function getAllGenericPasswordServices(){return Object.keys(localStorage).filter(k=>k.startsWith(prefix+'keychain:')).map(k=>k.slice((prefix+'keychain:').length))}`
);
put(
  "netinfo.ts",
  `export const fetch=async()=>({isConnected:navigator.onLine,isInternetReachable:navigator.onLine,type:'wifi'});export const addEventListener=(fn:any)=>{const on=()=>fn({isConnected:navigator.onLine,isInternetReachable:navigator.onLine,type:'wifi'});window.addEventListener('online',on);window.addEventListener('offline',on);queueMicrotask(on);return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',on)}};`
);
put(
  "safe-area.tsx",
  `import React from 'react';export const SafeAreaProvider=({children}:any)=><>{children}</>;export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`
);
put(
  "datepicker.tsx",
  `import React from 'react';export default function Picker(p:any){const date=(d:Date)=>d?d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'):undefined;return <input type="date" aria-label={p.accessibilityLabel} data-testid={p.testID} disabled={p.disabled} value={date(p.value)} min={date(p.minimumDate)} max={date(p.maximumDate)} onChange={e=>{const [y,m,d]=e.target.value.split('-').map(Number);if(y)p.onValueChange?.({type:'set'},new Date(y,m-1,d,12))}} style={{fontFamily:'inherit',fontSize:16,minHeight:38,width:'100%',border:0,background:'transparent',color:'#3e3549'}}/>}export const DateTimePickerAndroid={open(){throw Error('Native Android date dialog is outside browser fixture')}};`
);
put(
  "firebase-runtime.ts",
  `import {initializeApp} from 'firebase/app';import {getAuth,connectAuthEmulator} from 'firebase/auth';import {getFirestore,connectFirestoreEmulator} from 'firebase/firestore';import {getFunctions,connectFunctionsEmulator} from 'firebase/functions';import {run,actor} from './scope';export const app=initializeApp({projectId:'demo-cyclepair',apiKey:'demo-api-key',authDomain:'localhost',appId:'demo-cyclepair-qa'},'qa-'+run+'-'+actor);export const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9599',{disableWarnings:true});export const db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8530);export const functions=getFunctions(app,'asia-northeast3');connectFunctionsEmulator(functions,'127.0.0.1',5501);`
);
put(
  "firebase-app.ts",
  `export {app} from './firebase-runtime';import {app} from './firebase-runtime';export const getApp=()=>app;`
);
put(
  "firebase-auth.ts",
  `export * from 'firebase/auth';import {auth} from './firebase-runtime';export const getAuth=()=>auth;export const setLanguageCode=async(a:any,l:string)=>{a.languageCode=l};`
);
put(
  "firebase-firestore.ts",
  `export * from 'firebase/firestore';import {db} from './firebase-runtime';export const getFirestore=()=>db;export const initializeFirestore=async()=>db;`
);
put(
  "firebase-functions.ts",
  `export * from 'firebase/functions';import {functions} from './firebase-runtime';export const getFunctions=()=>functions;`
);
put(
  "firebase-analytics.ts",
  `export const getAnalytics=()=>({});export const logEvent=async()=>{};export const setAnalyticsCollectionEnabled=async()=>{};`
);
put(
  "firebase-crash.ts",
  `export const getCrashlytics=()=>({});export const recordError=()=>{};export const setAttributes=async()=>{};export const setCrashlyticsCollectionEnabled=async()=>{};`
);
put(
  "platform.ts",
  `export const SEORILABS_PLATFORM_APP_VERSION='development';export const platformFirebaseGuestClient={async createCredential(){throw Error('Production platform session unavailable in hermetic UI fixture')}};`
);
put(
  "native-host.tsx",
  `import React from 'react';import * as Native from 'react-native-web';export * from 'react-native-web';
const requested=Number(new URLSearchParams(location.search).get('fontScale')||1);export const fontScale=requested===2?2:1;
function scaled(style:any,allow:boolean|undefined){const value=Native.StyleSheet.flatten(style)||{};return allow===false?style:[style,{...(typeof value.fontSize==='number'?{fontSize:value.fontSize*fontScale}:{}),...(typeof value.lineHeight==='number'?{lineHeight:value.lineHeight*fontScale}:{})}]}
export function useWindowDimensions(){return {...Native.useWindowDimensions(),fontScale}}
function states(props:any){const value=props.accessibilityState||{};return Object.fromEntries(Object.entries(value).filter(([key])=>['checked','selected','disabled','expanded','busy'].includes(key)).map(([key,value])=>['aria-'+key,value]))}
export const Pressable=React.forwardRef((props:any,ref:any)=><Native.Pressable {...props} {...states(props)} ref={ref}/>);
export const View=React.forwardRef((props:any,ref:any)=><Native.View {...props} {...states(props)} ref={ref}/>);
export const Text=React.forwardRef((props:any,ref:any)=><Native.Text {...props} ref={ref} style={scaled(props.style,props.allowFontScaling)}/>);
export const TextInput=React.forwardRef((props:any,ref:any)=><Native.TextInput {...props} ref={ref} style={scaled(props.style,props.allowFontScaling)}/>);
const handlers=new Set<any>();export function pressBack(){for(const handler of Array.from(handlers).reverse())if(handler())return true;return false}
export const BackHandler={exitApp(){},addEventListener(type:string,handler:any){if(type==='hardwareBackPress')handlers.add(handler);return{remove:()=>handlers.delete(handler)}}};
const keyboardListeners=new Map<string,Set<any>>();export function emitKeyboard(visible:boolean){for(const key of [visible?'keyboardDidShow':'keyboardDidHide',visible?'keyboardWillShow':'keyboardWillHide'])for(const handler of keyboardListeners.get(key)||[])handler({endCoordinates:{height:visible?280:0}})}
export const Keyboard={...Native.Keyboard,addListener(name:string,callback:any){let list=keyboardListeners.get(name);if(!list){list=new Set();keyboardListeners.set(name,list)}list.add(callback);return{remove:()=>list!.delete(callback)}},dismiss(){Native.Keyboard.dismiss();emitKeyboard(false)}};
document.addEventListener('focusin',e=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)emitKeyboard(true)});document.addEventListener('focusout',()=>queueMicrotask(()=>{if(!(document.activeElement instanceof HTMLInputElement)&&!(document.activeElement instanceof HTMLTextAreaElement))emitKeyboard(false)}));
window.addEventListener('keydown',e=>{if(e.altKey&&e.key==='ArrowLeft'){if(pressBack())e.preventDefault()}});
`
);
const entry = `import {pressBack,emitKeyboard,fontScale} from './shims/native-host';import {Alert} from 'react-native';(Alert as any).alert=(title:string,message?:string,buttons:any[]=[])=>{const cancel=buttons.find((b:any)=>b.style==='cancel');const action=buttons.filter((b:any)=>b.style!=='cancel').at(-1);if(cancel){if(window.confirm(title+'\\n'+(message||'')))action?.onPress?.();else cancel?.onPress?.()}else{window.alert(title+'\\n'+(message||''));action?.onPress?.()}};import React from 'react';import {createRoot} from 'react-dom/client';import App from '${source}/apps/mobile/App';import {createFirebaseAccountAdapter} from '${source}/apps/mobile/src/platform/account/FirebaseAccountAdapter';import {firebaseCyclePairBackend} from '${source}/apps/mobile/src/platform/firebase/FirebaseCyclePairBackend';import {I18nProvider} from '${source}/apps/mobile/src/i18n/I18nProvider';import {auth,db} from './shims/firebase-runtime';import {doc,getDocFromServer} from 'firebase/firestore';import {signInAnonymously} from 'firebase/auth';import {httpsCallable} from 'firebase/functions';import {functions} from './shims/firebase-runtime';import {createNotificationClient} from '${source}/apps/mobile/src/platform/notifications/NotificationClient';import {prefix} from './shims/scope';import {createProductAnalytics} from '${source}/apps/mobile/src/platform/observability/ProductAnalytics';import {createSafeCrashReporter} from '${source}/apps/mobile/src/platform/observability/SafeCrashReporter';
const lang=new URLSearchParams(location.search).get('lang')==='ko'?'ko':'en';if(localStorage.getItem(prefix+'async:cyclepair.language.v1')===null)localStorage.setItem(prefix+'async:cyclepair.language.v1',lang);await auth.authStateReady();const account=createFirebaseAccountAdapter(undefined,{createGuestSession:async()=>{const {user}=await signInAnonymously(auth);return {uid:user.uid,email:user.email,isAnonymous:user.isAnonymous,emailVerified:user.emailVerified}},exportOrigin:'http://127.0.0.1:5501'});const calls:any[]=[];const analytics=createProductAnalytics({async setEnabled(enabled:boolean){calls.push({kind:'analytics-consent',enabled})},async log(name:string,params:any){calls.push({kind:'analytics',event:{name,...(params?{params}:{} )}})}});const crashReporter=createSafeCrashReporter({async setEnabled(enabled:boolean){calls.push({kind:'crash-consent',enabled})},async record(code:any,attributes:any){calls.push({kind:'crash',code,attributes})}});const permission=new URLSearchParams(location.search).get('notification')==='authorized'?'authorized':'denied';let fixtureToken='cyclepair-local-notification-fixture-'+prefix;let openListener:any;let refreshListener:any;
const notificationClient=createNotificationClient({async requestPermission(){calls.push({kind:'notification-permission',permission});return permission},async getToken(){return fixtureToken||('cyclepair-local-notification-fixture-'+prefix)},async register(registration:any){await httpsCallable(functions,'registerNotificationDevice')(registration)},async unregister(token:string){await httpsCallable(functions,'unregisterNotificationDevice')({token})},async deleteLocalToken(){fixtureToken=''},onTokenRefresh(listener:any){refreshListener=listener;return()=>{refreshListener=undefined}},onOpenedPayload(listener:any){openListener=listener;return()=>{openListener=undefined}}});
const faultable=new Set(['saveDailyLogChange','saveDailyLog','savePrivateSetup','saveShareSettings','loadPrivateSetup','syncDailyLogs','upsertPairEvent','deleteDailyLog']);const nextFault=new Map<string,any>();const held=new Map<string,any>();
function failNext(operation:string){if(!faultable.has(operation))throw Error('Unsupported fixture boundary');nextFault.set(operation,'fail')}
function holdNext(operation:string){if(!faultable.has(operation))throw Error('Unsupported fixture boundary');nextFault.set(operation,'hold')}
if(new URLSearchParams(location.search).get('holdSyncDailyLogs')==='1')holdNext('syncDailyLogs');
function releaseHeld(operation:string,fail=false){const release=held.get(operation);if(!release)throw Error('No held boundary operation');held.delete(operation);release(fail)}
const backend=new Proxy(firebaseCyclePairBackend,{get(target:any,key:string){const value=target[key];if(typeof value!=='function')return value;return faultable.has(key)?async(...args:any[])=>{const fault=nextFault.get(key);nextFault.delete(key);if(fault==='fail')throw Object.assign(new Error('Synthetic development unavailable'),{code:'unavailable'});if(fault==='hold'){calls.push({kind:'held-boundary',operation:key});const fail=await new Promise(resolve=>held.set(key,resolve));if(fail)throw Object.assign(new Error('Synthetic development unavailable'),{code:'unavailable'})}return value.apply(target,args)}:value.bind(target)}})
;Object.defineProperty(window,'__cyclePairQa',{value:{candidate:'${candidate}',sourceFingerprint:'${sourceFingerprint}',authorRun:${authorRun},fontScale,pressBack,emitKeyboard,failNext,holdNext,releaseHeld,get heldOperations(){return [...held.keys()]},openNotification:(payload:any)=>openListener?.(payload),refreshNotificationToken:(token:string)=>refreshListener?.(token),calls,get uid(){return auth.currentUser?.uid},async readOwnDaily(){const d=new Date();const day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');const snapshot=await getDocFromServer(doc(db,'users',auth.currentUser!.uid,'privateDailyLogs',day));return {exists:snapshot.exists(),day,record:snapshot.data()||null}},scope:'actual RN app and Firebase backend source; JS Firebase SDK and local platform boundaries',limitations:['fontScale adapter scales real Text/TextInput styles only; no OS font setting proof','host back/keyboard events invoke actual registered callbacks; no Android OS event proof','no native secure-storage guarantee','no real platform SSO','no native push SDK','no OS keyboard/safe area proof']}});createRoot(document.getElementById('root')!).render(<App backend={backend} account={account} analytics={analytics} crashReporter={crashReporter} notificationClient={notificationClient}/>);`;
fs.writeFileSync(path.join(task, "entry.tsx"), entry);
fs.writeFileSync(
  path.join(task, "dist/index.html"),
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cycle Pair development QA</title><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'
);
const map = {
  "@react-native-firebase/analytics": "firebase-analytics.ts",
  "@react-native-firebase/crashlytics": "firebase-crash.ts",
  "react-native-safe-area-context": "safe-area.tsx",
  "@react-native-async-storage/async-storage": "async-storage.ts",
  "react-native-keychain": "keychain.ts",
  "@react-native-community/netinfo": "netinfo.ts",
  "@react-native-community/datetimepicker": "datepicker.tsx",
  "@react-native-firebase/app": "firebase-app.ts",
  "@react-native-firebase/auth": "firebase-auth.ts",
  "@react-native-firebase/firestore": "firebase-firestore.ts",
  "@react-native-firebase/functions": "firebase-functions.ts",
};
await build({
  entryPoints: [path.join(task, "entry.tsx")],
  bundle: true,
  outfile: path.join(task, "dist/app.js"),
  platform: "browser",
  format: "esm",
  target: "es2022",
  loader: { ".png": "file" },
  assetNames: "assets/[name]-[hash]",
  nodePaths: [
    path.join(task, "node_modules"),
    path.join(source, "node_modules"),
  ],
  define: { "process.env.NODE_ENV": '"development"', __DEV__: "true" },
  jsx: "automatic",
  logLevel: "warning",
  metafile: true,
  plugins: [
    {
      name: "platform-boundaries",
      setup(b) {
        b.onResolve({ filter: /^react$/ }, () => ({
          path: req.resolve("react"),
        }));
        b.onResolve({ filter: /^react\/jsx-(runtime|dev-runtime)$/ }, (a) => ({
          path: req.resolve(a.path),
        }));
        b.onResolve({ filter: /^react-dom\/client$/ }, () => ({
          path: req.resolve("react-dom/client"),
        }));
        b.onResolve({ filter: /^react-native$/ }, () => ({
          path: path.join(task, "shims/native-host.tsx"),
        }));
        b.onResolve({ filter: /^@cyclepair\/product-core$/ }, () => ({
          path: path.join(source, "packages/product-core/src/index.ts"),
        }));
        b.onResolve({ filter: /./ }, (a) =>
          map[a.path]
            ? { path: path.join(task, "shims", map[a.path]) }
            : undefined
        );
        b.onResolve(
          {
            filter:
              /(^|\/)(seorilabsPlatform|PlatformFirebaseGuestClient)(\.ts)?$/,
          },
          () => ({ path: path.join(task, "shims/platform.ts") })
        );
      },
    },
  ],
}).then((r) =>
  fs.writeFileSync(
    path.join(task, "bundle-metafile.json"),
    JSON.stringify(r.metafile, null, 2) + "\n"
  )
);
fs.writeFileSync(
  path.join(task, "fixture-plan.json"),
  JSON.stringify(
    {
      candidate,
      observedHead,
      source,
      sourceFingerprint,
      sourceFileCount: fingerprintPaths.length,
      entry:
        "actual apps/mobile/App.tsx; complete original AppContent and UI/store/backend/account sources",
      runtime: "react-native-web 0.21.4; react-dom 19.2.3; Firebase JS 12.16.0",
      boundaries: map,
      productionNetworkAllowed: false,
      emulatorProject: "demo-cyclepair",
      ownPorts: { web: 4177, auth: 9599, firestore: 8530, functions: 5501 },
      authorRun,
      productDrift: productDrift ? productDrift.split("\n") : [],
      formalRound: false,
    },
    null,
    2
  ) + "\n"
);
console.log("Built full actual RN app development runtime for " + candidate);
