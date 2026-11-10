import { useContext, useState } from "react";
import { Button, Form, FormControl } from "react-bootstrap";
import { AtlantContext } from "../../../core/context.jsx";

const RegisterDriver = () => {
    const { post } = useContext(AtlantContext);

    const [fullName, setFullName] = useState("");
    const [experienceStartYear, setExperienceStartYear] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();

        await post("RegisterDriver", [fullName, experienceStartYear]);
    };

    return (
        <Form onSubmit={handleSubmit}>
            <h2>RegisterDriver</h2>
            <FormControl placeholder="ФИО" onChange={(e) => setFullName(e.target.value)} />
            <hr/>
            <FormControl placeholder="Год начала водительского стажа, например 2020" onChange={(e) => setExperienceStartYear(e.target.value)} />

            <Button type="submit">Отправить</Button>
        </Form>
    );
};

export default RegisterDriver;
