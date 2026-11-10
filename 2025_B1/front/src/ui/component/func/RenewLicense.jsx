import { useContext } from "react";
import { Button, Form } from "react-bootstrap";
import { AtlantContext } from "../../../core/context.jsx";

const RenewLicense = () => {
    const { post } = useContext(AtlantContext);

    const handleSubmit = async (e) => {
        e.preventDefault();

        await post("RenewLicense", []);
    };

    return (
        <Form onSubmit={handleSubmit}>
            <h2>RenewLicense</h2>
            <p>Продление возможно, если до окончания срока остался месяц или меньше и все штрафы оплачены</p>
            <Button type="submit">Запросить продление</Button>
        </Form>
    );
};

export default RenewLicense;
