import Modal from '../ui/Modal';
import ProPanel from './ProPanel';
import type { MaskordProState } from '../../hooks/useMaskordPro';

interface Props {
  uid: string;
  displayName: string;
  pro: MaskordProState;
  onUpgrade: () => void;
  onClose: () => void;
}

/**
 * The Pro panel as a modal, for when it is reached from the debate floor rather
 * than from User Settings. Same panel in both places — see `ProPanel`.
 */
export default function ProPanelModal({ uid, displayName, pro, onUpgrade, onClose }: Props) {
  return (
    <Modal title="Maskord Pro" onClose={onClose} width="max-w-lg">
      <div className="px-6 pb-6">
        <ProPanel uid={uid} displayName={displayName} pro={pro} onUpgrade={onUpgrade} />
      </div>
    </Modal>
  );
}
