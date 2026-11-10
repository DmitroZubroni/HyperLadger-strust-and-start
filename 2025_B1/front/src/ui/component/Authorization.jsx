import {Button, Form, FormControl} from "react-bootstrap";
import {AtlantContext} from "../../core/context.jsx";
import {useContext, useState} from "react";

const Authorization = () => {
    const { login } = useContext(AtlantContext);

    const [name, setName] = useState("");

    const handleSubmit = (e) => {
        e.preventDefault();

        login(name);
        alert("вы авторизовались");
    };

    return (
        <Form className="container" onSubmit={handleSubmit}>
            <h2> авторизация</h2>
            <FormControl placeholder="имя, например ivanov@users.example.com или Admin@bank.example.com"
                         onChange={(e) => setName(e.target.value)} />
            <hr/>
            <Button type="submit">Войти</Button>
        </Form>
    );
}

export default Authorization;
