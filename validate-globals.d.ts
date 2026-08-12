declare class Response { constructor(body?: any, init?: any); ok:boolean; status:number; body:any; text():Promise<string>; json():Promise<any>; }
declare class Headers { constructor(init?: any); set(k:string,v:string):void; }
declare class Request { method:string; url:string; headers:{get(k:string):string|null}; json():Promise<any>; }
declare class URL { constructor(url:string); pathname:string; }
declare var crypto: { randomUUID(): string };
declare var fetch: (input:any, init?:any)=>Promise<any>;
declare var JSON: JSON;
declare interface ResponseInit { headers?: any; status?: number; }
declare interface D1ResultMeta { changes?: number; }
declare interface D1Result<T=any> { results:T[]; meta?:D1ResultMeta; }
declare interface D1PreparedStatement { bind(...values:any[]):D1PreparedStatement; run():Promise<D1Result>; first<T=any>():Promise<T|null>; all<T=any>():Promise<D1Result<T>>; }
declare interface D1Database { prepare(sql:string):D1PreparedStatement; batch(stmts:D1PreparedStatement[]):Promise<any[]>; }
declare interface Queue<T=any> { send(body:T):Promise<void>; }
declare interface Workflow { createBatch(items:any[]):Promise<any>; get(id:string):Promise<WorkflowInstance>; }
declare interface Message<T=any> { body:T; attempts:number; ack():void; retry(opts?:{delaySeconds?:number}):void; }
declare interface MessageBatch<T=any> { messages:Message<T>[]; }
declare interface ScheduledController {}
declare interface ExecutionContext {}
declare module "cloudflare:workers" {
  export class WorkflowEntrypoint<Env, Params> { env:Env; }
  export interface WorkflowEvent<Params> { payload:Params; }
  export interface WorkflowStep { do<T>(name:string, fn:()=>Promise<T>):Promise<T>; do<T>(name:string, opts:any, fn:()=>Promise<T>):Promise<T>; }
}
declare interface RequestInit { method?: string; headers?: any; body?: any; signal?: any; }
declare class AbortController { signal:any; abort(reason?:any):void; }
declare function setTimeout(fn:()=>void, ms:number): any;
declare function clearTimeout(id:any): void;
declare interface WorkflowInstanceStatus { status:string; error?:any; output?:any; rollback?:any; }
declare interface WorkflowInstance { id:string; status():Promise<WorkflowInstanceStatus>; terminate(options?:{rollback?:boolean}):Promise<void>; }

declare class TextDecoder { decode(input?: any, options?: {stream?: boolean}): string; }
declare class TextEncoder { encode(input?: string): Uint8Array; }
declare function btoa(input: string): string;
