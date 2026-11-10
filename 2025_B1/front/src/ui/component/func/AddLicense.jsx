import { useContext, useState } from "react";
import { Button, Form, FormControl } from "react-bootstrap";
import { AtlantContext } from "../../../core/context.jsx";

const AddLicense = () => {
    const { post } = useContext(AtlantContext);

    const [number, setNumber] = useState("");
    const [expiresAt, setExpiresAt] = useState("");
    const [category, setCategory] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();

        await post("AddLicense", [number, expiresAt, category]);
    };

    return (
        <Form onSubmit={handleSubmit}>
            <h2>AddLicense</h2>
            <FormControl placeholder="Номер удостоверения" onChange={(e) => setNumber(e.target.value)} />
            <hr/>
            <FormControl placeholder="Срок действия ДД.ММ.ГГГГ" onChange={(e) => setExpiresAt(e.target.value)} />
            <hr/>
            <FormControl placeholder="Категория A, B или C" onChange={(e) => setCategory(e.target.value)} />

            <Button type="submit">Отправить</Button>
        </Form>
    );
};

export default AddLicense;
