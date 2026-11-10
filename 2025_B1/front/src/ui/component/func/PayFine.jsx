import { useContext, useState } from "react";
import { Button, Form, FormControl } from "react-bootstrap";
import { AtlantContext } from "../../../core/context.jsx";

const PayFine = () => {
    const { post } = useContext(AtlantContext);

    const [fineId, setFineId] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();

        await post("PayFine", [fineId]);
    };

    return (
        <Form onSubmit={handleSubmit}>
            <h2>PayFine</h2>
            <FormControl placeholder="ID штрафа из личного кабинета" onChange={(e) => setFineId(e.target.value)} />

            <Button type="submit">Отправить</Button>
        </Form>
    );
};

export default PayFine;
