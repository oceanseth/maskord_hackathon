import { RoomShell, mountRoomPage } from '../RoomShell';
import { RoomPanel } from '../RoomPanel';
import { useRoom, type RoomIdentity } from '../useRoom';

function WizardRoom({ identity }: { identity: RoomIdentity }) {
  const room = useRoom({ kind: 'wizard', title: "The Wizard's Table", identity });
  return <RoomPanel room={room} placeholder="What do you do?" />;
}

mountRoomPage(<RoomShell render={(identity) => <WizardRoom identity={identity} />} />);
