import { RoomShell, mountRoomPage } from '../RoomShell';
import { RoomPanel } from '../RoomPanel';
import { useRoom, type RoomIdentity } from '../useRoom';

function DebateRoom({ identity }: { identity: RoomIdentity }) {
  const room = useRoom({ kind: 'debate', title: 'Debate', identity });
  return <RoomPanel room={room} placeholder="Make your point…" />;
}

mountRoomPage(<RoomShell render={(identity) => <DebateRoom identity={identity} />} />);
