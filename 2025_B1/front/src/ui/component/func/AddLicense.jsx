import { useContext, useState } from "react";
import { Button, Form, FormControl } from "react-bootstrap";
import { AtlantContext } from "../../../core/context.jsx";

const AddLicense = () => {
    const { post } = useContext(AtlantContext);

    const [number, setNumber] = useState("");
    const [expiresAt, setExpiresAt] = useState("");
    const [category, setCategory] = useState("A");

    const handleSubmit = async (e) => {
        e.preventDefault();
        // Поле даты отдаёт ГГГГ-ММ-ДД: в этом формате даты хранит контракт
        await post("AddLicense", [number, expiresAt, category]);
    };

    return (
        <Form onSubmit={handleSubmit}>
            <h2>AddLicense</h2>
            <FormControl placeholder="Номер удостоверения" required onChange={(e) => setNumber(e.target.value)} />
            <hr/>
            <Form.Label>Срок действия</Form.Label>
            <FormControl type="date" required onChange={(e) => setExpiresAt(e.target.value)} />
            <hr/>
            <Form.Select onChange={(e) => setCategory(e.target.value)}>
                <option>A</option>
                <option>B</option>
                <option>C</option>
            </Form.Select>
            <hr/>
            <Button type="submit">Отправить</Button>
        </Form>
    );
};

export default AddLicense;
