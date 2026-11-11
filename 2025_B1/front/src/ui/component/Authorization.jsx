import {Button, Form, FormControl} from "react-bootstrap";
import {AtlantContext} from "../../core/context.jsx";
import {useContext, useState} from "react";

const Authorization = () => {
    const { login, register } = useContext(AtlantContext);

    const [name, setName] = useState("");
    const [password, setPassword] = useState("");

    const [newName, setNewName] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [fullName, setFullName] = useState("");
    const [experienceStartYear, setExperienceStartYear] = useState("");

    const handleLogin = async (e) => {
        e.preventDefault();
        await login(name, password);
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        await register(newName, newPassword, fullName, experienceStartYear);
    };

    return (
        <div className="container">
            <Form onSubmit={handleLogin}>
                <h2> авторизация</h2>
                <FormControl placeholder="имя, например ivanov или admin" required
                             onChange={(e) => setName(e.target.value)} />
                <hr/>
                <FormControl type="password" placeholder="пароль" required
                             onChange={(e) => setPassword(e.target.value)} />
                <hr/>
                <Button type="submit">Войти</Button>
            </Form>
            <hr/>
            <Form onSubmit={handleRegister}>
                <h2> регистрация водителя</h2>
                <FormControl placeholder="имя латиницей, например romanov" required
                             onChange={(e) => setNewName(e.target.value)} />
                <hr/>
                <FormControl type="password" placeholder="пароль" required
                             onChange={(e) => setNewPassword(e.target.value)} />
                <hr/>
                <FormControl placeholder="ФИО" required onChange={(e) => setFullName(e.target.value)} />
                <hr/>
                <FormControl type="number" placeholder="Год начала водительского стажа, например 2020" required
                             onChange={(e) => setExperienceStartYear(e.target.value)} />
                <hr/>
                <Button type="submit">Зарегистрироваться</Button>
            </Form>
        </div>
    );
}

export default Authorization;
