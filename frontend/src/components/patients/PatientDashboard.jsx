import { useNavigate } from "react-router-dom";
import PatientList from "./PatientList";

const PatientDashboard = () => {
  const navigate = useNavigate();

  // Handle add patient - this is a fallback in case the direct navigation in PatientList doesn't work
  const handleAddPatient = () => {
    navigate('/patients/create');
  };

  return (
    <div className="max-w-7xl mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Patient Management</h1>
        <p className="text-muted-foreground">
          Manage patient records, search for patients, and view patient details.
        </p>
      </div>
      <PatientList onAddPatient={handleAddPatient} />
    </div>
  );
};

export default PatientDashboard;
