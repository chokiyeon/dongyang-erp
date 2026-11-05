import type {creditVehicleRestore} from '@/lib/trade-vehicle-settlement';
export function CreditVehicleRestoreFields({restore}:{restore:NonNullable<Awaited<ReturnType<typeof creditVehicleRestore>>>}){
 return <div className="grid gap-2 rounded border p-3"><h3>차량 비용 함께 복원</h3><p>{restore.plate} · {restore.reference} · {restore.title}</p><p>현재 차량 비용 {BigInt(restore.currentAmount).toLocaleString()}원 · {restore.voided?'취소됨':'사용 중'} → 복원 {BigInt(restore.amount).toLocaleString()}원 · 사용 중</p><input type="hidden" name="vehicleCostVersion" value={restore.version}/><input type="hidden" name="vehicleVersion" value={restore.vehicleVersion}/><label><input type="checkbox" name="vehicleRestoreConfirmed" required/>현재 차량 비용을 위 수정증빙 반영 전 금액으로 함께 복원하는 것을 확인했습니다.</label></div>;
}
