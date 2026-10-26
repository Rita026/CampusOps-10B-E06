import { campusOpsServices } from './src/bootstrap/campusOpsServices';
import { CampusOpsApp } from './src/ui/CampusOpsApp';

const offlineSync = {
  queue: campusOpsServices.pendingOperations,
  synchronize: () => campusOpsServices.incidentSync.synchronize(),
};

export default function App() {
  return (
    <CampusOpsApp
      checkBackendHealth={campusOpsServices.checkBackendHealth}
      incidentClient={campusOpsServices.incidentClient}
      offlineSync={offlineSync}
      session={campusOpsServices.session}
    />
  );
}
