import {AppProvider} from "./core/context.jsx";
import {RouterProvider} from "react-router-dom";
import {routing} from "./core/routing.jsx";

function App() {
  return (
      <AppProvider>
        <RouterProvider router={routing}/>
      </AppProvider>
  )
}

export default App
