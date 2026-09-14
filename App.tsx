import { campusOpsServices } from './src/bootstrap/campusOpsServices';
import { CampusOpsApp } from './src/ui/CampusOpsApp';

export default function App() {
  return (
    <CampusOpsApp
      checkBackendHealth={campusOpsServices.checkBackendHealth}
      incidentQueries={campusOpsServices.incidentQueries}
    />
  );
}
