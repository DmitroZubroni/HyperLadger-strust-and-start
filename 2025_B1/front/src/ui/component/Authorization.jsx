import {Button, Form, FormControl} from "react-bootstrap";
import {AtlantContext} from "../../core/context.jsx";
import {useContext, useState} from "react";

const Authorization = () => {
    const { login, register } = useContext(AtlantContext);

    const [name, setName] = useState("");
    const [newName, setNewName] = useState("");
    const [fullName, setFullName] = useState("");
    const [experienceStartYear, setExperienceStartYear] = useState("");

    const handleLogin = async (e) => {
        e.preventDefault();
        await login(name);
    };

    // Регистрация водителя: имя должно быть заранее создано в терминале
    const handleRegister = async (e) => {
        e.preventDefault();
        await register(newName, fullName, experienceStartYear);
    };

    return (
        <div className="container">
            <Form onSubmit={handleLogin}>
                <h2> авторизация</h2>
                <FormControl placeholder="имя, например ivanov@users.example.com или Admin@bank.example.com"
                             onChange={(e) => setName(e.target.value)} />
                <hr/>
                <Button type="submit">Войти</Button>
            </Form>
            <hr/>
            <Form onSubmit={handleRegister}>
                <h2> регистрация водителя</h2>
                <FormControl placeholder="имя, созданное в терминале, например romanov@users.example.com"
                             onChange={(e) => setNewName(e.target.value)} />
                <hr/>
                <FormControl placeholder="ФИО" onChange={(e) => setFullName(e.target.value)} />
                <hr/>
                <FormControl placeholder="Год начала водительского стажа, например 2020"
                             onChange={(e) => setExperienceStartYear(e.target.value)} />
                <hr/>
                <Button type="submit">Зарегистрироваться</Button>
            </Form>
        </div>
    );
}

export default Authorization;
