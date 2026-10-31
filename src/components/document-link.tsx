import Link from "next/link";
export function DocumentLink({type,id}:{type:string;id:string}){return <Link className="erp-row-action" href={`/documents?type=${encodeURIComponent(type)}&source=${encodeURIComponent(id)}`}>원본 파일·사진 첨부</Link>;}
