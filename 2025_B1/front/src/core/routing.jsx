import {createBrowserRouter} from "react-router-dom";
import UserInfo from "../ui/pages/UserInfo.jsx";
import Function from "../ui/pages/Function.jsx";


const routes = [
    {
        path: "/",
        element: <UserInfo />,
    },
    {
        path: "/func",
        element: <Function />,
    }
]
const routing = createBrowserRouter(routes);
export { routing };
