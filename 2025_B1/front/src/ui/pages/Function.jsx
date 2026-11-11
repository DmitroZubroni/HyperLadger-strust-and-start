import { useContext } from "react";
import { Tabs, Tab, Alert } from "react-bootstrap";
import { AtlantContext } from "../../core/context.jsx";

import Header from "../component/Header.jsx";
import Authorization from "../component/Authorization.jsx";

import AddLicense from "../component/func/AddLicense.jsx";
import RegisterVehicle from "../component/func/RegisterVehicle.jsx";
import RenewLicense from "../component/func/RenewLicense.jsx";
import PayFine from "../component/func/PayFine.jsx";

import IssueFine from "../component/func/IssueFine.jsx";

// Вкладки по ролям: водителю — функции водителя, сотруднику ДПС — выписка штрафов
const Function = () => {
    const { isAuthorized, isBank, isDps, isDriver } = useContext(AtlantContext);

    return (
        <div>
            <Header />

            {!isAuthorized ? (
                <Authorization />
            ) : (
                <div className="container">
                    {isBank && <Alert>У банка нет функций: штрафы поступают на счёт автоматически, баланс — в личном кабинете.</Alert>}
                    <Tabs>
                        {isDriver && (
                            <Tab eventKey="driver" title="Водитель">
                                <AddLicense />
                                <hr />
                                <RegisterVehicle />
                                <hr />
                                <RenewLicense />
                                <hr />
                                <PayFine />
                            </Tab>
                        )}

                        {isDps && (
                            <Tab eventKey="dps" title="Сотрудник ДПС">
                                <IssueFine />
                            </Tab>
                        )}
                    </Tabs>
                </div>
            )}
        </div>
    );
};

export default Function;
