import { useContext, useState } from "react";
import { Button, Form, FormControl } from "react-bootstrap";
import { AtlantContext } from "../../../core/context.jsx";

const IssueFine = () => {
    const { post } = useContext(AtlantContext);

    const [licenseNumber, setLicenseNumber] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();

        await post("IssueFine", [licenseNumber]);
    };

    return (
        <Form onSubmit={handleSubmit}>
            <h2>IssueFine</h2>
            <FormControl placeholder="Номер водительского удостоверения" onChange={(e) => setLicenseNumber(e.target.value)} />

            <Button type="submit">Отправить</Button>
        </Form>
    );
};

export default IssueFine;
