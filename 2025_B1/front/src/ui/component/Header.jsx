import {useContext} from "react";
import {AtlantContext} from "../../core/context.jsx";
import {Link} from "react-router-dom";

const Header = () => {
    const {user, logout} = useContext(AtlantContext);

    return (
        <div className="navbar" style={{background: "#2f6db5", color: "white", padding: "15px"}}>
            <h2> Безопасное дорожное движение</h2>
            {
                !user ?
                    <>
                        <Link to="/" style={{color:"white"}} className="btn">страница авторизации</Link>
                    </> :
                    <>
                        <span>{user}</span>
                        <Link to="/" style={{color:"white"}} className="btn"> личный кабинет</Link>
                        <Link to="/func" style={{color:"white"}} className="btn"> функции </Link>
                        <Link to="/" style={{color:"white"}} className="btn" onClick={logout}> выйти </Link>
                    </>
            }
        </div>
    )
}
export default Header;
