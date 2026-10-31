import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { LegacyTransferRequestForm } from '@/features/inventory/transfers/LegacyTransferRequestForm';
import { RustTransferRequestForm } from '@/features/inventory/transfers/RustTransferRequestForm';

export function TransferRequestForm(props) {
  return isRustV2ApiMode() ? <RustTransferRequestForm {...props} /> : <LegacyTransferRequestForm {...props} />;
}
