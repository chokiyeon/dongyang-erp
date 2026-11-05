import type {VehicleCostProposal} from '@/lib/trade-vehicle-settlement';
export type VehicleCostView=VehicleCostProposal&{vehicleId:string;plate:string;reference:string;title:string;amount:string;voided:boolean};
export function CreditVehicleFields({vehicle,nextAmount,cancel}:{vehicle:VehicleCostView;nextAmount:string;cancel:boolean}){
 return <fieldset className="grid gap-2 rounded border border-slate-300 p-3"><legend>수정증빙과 차량 비용 정산</legend><p>{vehicle.plate} · {vehicle.reference} · {vehicle.title}</p><p>현재 차량 비용 {BigInt(vehicle.amount).toLocaleString()}원 → {cancel?'전액취소 · 이력 보존':`감액 후 ${BigInt(nextAmount).toLocaleString()}원`}</p><input type="hidden" name="vehicleCost" value={JSON.stringify({expenseId:vehicle.expenseId,version:vehicle.version,vehicleVersion:vehicle.vehicleVersion})}/><label><input type="checkbox" name="vehicleCostConfirmed" required/>수정증빙과 연결 차량 비용의 금액·취소 여부를 함께 확인했습니다.</label><p className="text-xs">원 은행 거래와 차량 증빙은 보존하고 차량 비용을 새로 중복 생성하지 않습니다.</p></fieldset>;
}
