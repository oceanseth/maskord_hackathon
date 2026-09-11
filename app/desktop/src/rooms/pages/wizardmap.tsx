import { RoomScreen, mountRoomPage } from '../RoomShell';
import { EventLog, MemberStrip, StatusPill } from '../RoomPanel';
import { useRoom } from '../useRoom';

function WizardMap() {
  const room = useRoom({ kind: 'wizard', title: "The Wizard's Table", identity: null });
  return (
    <div className="flex flex-col h-full min-h-0 p-4 gap-3">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-semibold">{room.room?.title ?? "The Wizard's Table"}</h1>
        <StatusPill status={room.room?.status ?? 'lobby'} />
      </div>
      <MemberStrip members={room.members} />
      <EventLog events={room.events} />
    </div>
  );
}

mountRoomPage(<RoomScreen render={() => <WizardMap />} />);
